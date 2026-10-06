import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  SelfPayTransactionManager,
  PRODUCT_RECORD_KINDS,
  type TransactionJournal,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, missingIndex } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { NativeDeviceSigner, type NativeInvoke, call } from "./native-device";
import { NativeDirectAgent } from "./direct-agent";
import {
  normalizeMessageOkrSource,
  verifyMessageOkrSource,
  type MessageOkrSource,
} from "./message-okr-source";
export type DraftKr = {
  title: string;
  unit: string;
  precision: number;
  baseline: string;
  target: string;
  weight: string;
  maxAgeMinutes: string;
  verificationRule: string;
};
export type DraftInput = {
  objective: string;
  successCriteria: string;
  priority: number;
  deadlineMs: string;
  krs: DraftKr[];
  allowedPaths: string[];
  prohibitedActions: string[];
  maxCalls: string;
  source?: MessageOkrSource;
};
export class OkrDraftError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "deadline_expired"
      | "already_exists"
      | "authority_changed"
      | "invalid_ciphertext"
      | "invalid_quote",
  ) {
    super(code);
  }
}
const maxU64 = 2n ** 64n - 1n;
function integer(value: string, maximum = maxU64, minimum = 0n) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    value.length > 20
  )
    throw new OkrDraftError("invalid_input");
  const n = BigInt(value);
  if (n < minimum || n > maximum) throw new OkrDraftError("invalid_input");
  return n;
}
function text(value: string, max: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    new TextEncoder().encode(value.trim()).length > max
  )
    throw new OkrDraftError("invalid_input");
  return value.trim();
}
/** Exact fixed-point parsing, never Number multiplication or silent rounding. */
export function scaledMetric(value: string, precision: number) {
  if (
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 6 ||
    typeof value !== "string" ||
    value.length > 28 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  )
    throw new OkrDraftError("invalid_input");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > precision) throw new OkrDraftError("invalid_input");
  const n =
    BigInt(whole) * 10n ** BigInt(precision) +
    BigInt(fraction.padEnd(precision, "0") || "0");
  if (n > maxU64) throw new OkrDraftError("invalid_input");
  return n.toString();
}
export function normalizeDraft(input: DraftInput) {
  if (
    !Array.isArray(input.krs) ||
    input.krs.length < 1 ||
    input.krs.length > 3 ||
    !Number.isInteger(input.priority) ||
    input.priority < 0 ||
    input.priority > 2
  )
    throw new OkrDraftError("invalid_input");
  const paths = input.allowedPaths?.map((p) =>
    text(p, 256).replaceAll("\\", "/"),
  );
  if (
    !paths?.length ||
    paths.length > 16 ||
    new Set(paths).size !== paths.length ||
    paths.some(
      (p) =>
        p.startsWith("/") ||
        p.includes(":") ||
        p.includes("\0") ||
        p.split("/").some((s) => s === ".." || !s),
    )
  )
    throw new OkrDraftError("invalid_input");
  if (
    !Array.isArray(input.prohibitedActions) ||
    !input.prohibitedActions.length ||
    input.prohibitedActions.length > 16
  )
    throw new OkrDraftError("invalid_input");
  const krs = input.krs.map((kr) => {
    const baseline = scaledMetric(kr.baseline, kr.precision),
      target = scaledMetric(kr.target, kr.precision);
    if (baseline === target) throw new OkrDraftError("invalid_input");
    return {
      title: text(kr.title, 256),
      unit: text(kr.unit, 64),
      precision: kr.precision,
      scale: (10n ** BigInt(kr.precision)).toString(),
      baseline,
      target,
      weight: integer(kr.weight, 1000000n, 1n).toString(),
      maxAgeMs: (integer(kr.maxAgeMinutes, 43200n, 1n) * 60000n).toString(),
      verificationRule: text(kr.verificationRule, 2048),
    };
  });
  return {
    schema: "fractalmind.okr-spec.v1",
    ...(input.source === undefined
      ? {}
      : { source: normalizeMessageOkrSource(input.source) }),
    objective: text(input.objective, 512),
    successCriteria: text(input.successCriteria, 4096),
    priority: input.priority,
    deadlineMs: integer(input.deadlineMs, maxU64, 1n).toString(),
    krs,
    constraints: {
      allowedPaths: paths,
      prohibitedActions: input.prohibitedActions.map((p) => text(p, 512)),
      budget: {
        asset: "TOOL_CALLS",
        limit: integer(input.maxCalls, maxU64, 1n).toString(),
      },
    },
  };
}
/** Product state remains chain-owned. Quotes are ephemeral, durable technical
 * request IDs/digests are queried before rebuilding or broadcasting. */
export class OkrDraftCreation {
  readonly manager: SelfPayTransactionManager;
  readonly requestId: string;
  private verifier: DeviceIdentityVerifier;
  private plans = new WeakMap<
    SelfPayFeeQuote,
    { pin: string; deadline: string; source?: MessageOkrSource }
  >();
  private signingGuard?: () => Promise<void>;
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly logicalId: string,
    private invoke: NativeInvoke,
    private journal: TransactionJournal,
    private assertActive: () => void = () => {},
  ) {
    if (
      !/^0x[0-9a-f]{64}$/.test(organizationId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        logicalId,
      )
    )
      throw new OkrDraftError("invalid_input");
    this.requestId = `okr-draft:${organizationId}:${logicalId}`;
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      assertBeforeBroadcast: assertActive,
      signer: {
        getPublicKey: () => signer.getPublicKey(),
        signTransaction: async (bytes) => {
          const guard = this.signingGuard;
          if (!guard) throw new OkrDraftError("invalid_quote");
          await guard();
          const signed = await signer.signTransaction(bytes);
          await guard();
          return signed;
        },
      },
      journal,
    });
  }
  async query() {
    this.assertActive();
    await this.chain.checkNetwork();
    return this.manager.query(this.requestId);
  }
  private async verifySource(source?: MessageOkrSource) {
    this.assertActive();
    if (source)
      await verifyMessageOkrSource(
        new NativeDirectAgent(
          this.chain,
          this.signer,
          this.grantId,
          this.organizationId,
          source.managedAgentId,
          this.invoke,
          this.journal,
          fetch,
          this.assertActive,
        ),
        source,
      );
    this.assertActive();
  }
  private async exists() {
    let cursor: string | null = null;
    const seen = new Set<string>();
    let count = 0;
    do {
      const page: {
        okrs: Array<{ logical_id: string }>;
        cursor: string | null;
        hasNextPage: boolean;
      } = await this.chain.sdk.okr
        .listOkrs(this.organizationId, cursor, 50)
        .catch(async (error) => {
          if (
            cursor === null &&
            this.chain.sdk.okr.isMissingIndex(error, this.organizationId)
          )
            return { okrs: [], cursor: null, hasNextPage: false };
          throw error;
        });
      if (page.okrs.some((o) => o.logical_id === this.logicalId)) return true;
      if (!page.hasNextPage) return false;
      count += page.okrs.length;
      if (!page.cursor || seen.has(page.cursor) || count > 1000)
        throw new OkrDraftError("invalid_input");
      seen.add(page.cursor);
      cursor = page.cursor;
    } while (cursor);
    return false;
  }
  async prepare(
    input: DraftInput,
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    const requested = structuredClone(input);
    const prior = await this.query();
    if (prior) return prior;
    const spec = normalizeDraft(requested),
      before = await this.verifier.verifyOrganization(
        this.organizationId,
        "approve",
      );
    if (BigInt(spec.deadlineMs) <= before.clockMs)
      throw new OkrDraftError("deadline_expired");
    if (await this.exists()) throw new OkrDraftError("already_exists");
    await this.verifySource(spec.source);
    const page = await this.chain.sdk.productRecord
      .listCurrent(this.organizationId, null, 1)
      .catch(async (error) => {
        if (
          missingIndex(
            error,
            this.organizationId,
            await this.chain.sdk.client.coreType(
              "product_record",
              "IndexBinding",
            ),
          )
        )
          return { keyVersion: "1" };
        throw error;
      });
    const keyVersion = page.keyVersion;
    const plaintext = new TextEncoder().encode(JSON.stringify(spec));
    let result: unknown;
    try {
      result = await call(this.invoke, "fm_device_encrypt_record", {
        profile: this.signer.device.profile,
        record: JSON.stringify({
          network: this.chain.profile.network,
          encryptedKeys: before.encryptedKeys,
          organizationId: this.organizationId,
          kind: PRODUCT_RECORD_KINDS.okr,
          logicalId: `okr-${this.logicalId}-spec`,
          revision: "1",
          keyVersion,
          plaintext: toBase64(plaintext),
        }),
      });
    } finally {
      plaintext.fill(0);
    }
    if (typeof result !== "string" || result.length > 87384)
      throw new OkrDraftError("invalid_ciphertext");
    let body: Uint8Array;
    try {
      body = fromBase64(result);
      if (
        body.length < 32 ||
        body.length > 65536 ||
        toBase64(body) !== result ||
        new TextDecoder().decode(body.slice(0, 4)) !== "FME1"
      )
        throw new Error();
    } catch {
      throw new OkrDraftError("invalid_ciphertext");
    }
    const after = await this.verifier.verifyOrganization(
      this.organizationId,
      "approve",
    );
    if (before.authorityPin !== after.authorityPin || !after.authorityPin)
      throw new OkrDraftError("authority_changed");
    await this.verifySource(spec.source);
    const transaction = this.chain.sdk.okr.createDraft({
      organizationId: this.organizationId,
      humanId: this.chain.profile.humanId,
      grantId: this.grantId,
      logicalId: this.logicalId,
      priority: spec.priority,
      deadlineMs: spec.deadlineMs,
      baselines: spec.krs.map((k) => k.baseline),
      targets: spec.krs.map((k) => k.target),
      weights: spec.krs.map((k) => k.weight),
      maxAgesMs: spec.krs.map((k) => k.maxAgeMs),
      keyVersion,
      encryptedBody: body,
    });
    const quote = await this.manager.prepare({
      requestId: this.requestId,
      gasBudget: 200_000_000n,
      transaction,
    });
    await this.verifySource(spec.source);
    this.plans.set(quote, {
      pin: after.authorityPin,
      deadline: spec.deadlineMs,
      source: spec.source,
    });
    return quote;
  }
  async submit(quote: SelfPayFeeQuote) {
    const plan = this.plans.get(quote);
    if (!plan || quote.requestId !== this.requestId)
      throw new OkrDraftError("invalid_quote");
    const guard = async () => {
      this.assertActive();
      const current = await this.verifier.verifyOrganization(
        this.organizationId,
        "approve",
      );
      if (current.authorityPin !== plan.pin)
        throw new OkrDraftError("authority_changed");
      if (BigInt(plan.deadline) <= current.clockMs)
        throw new OkrDraftError("deadline_expired");
      await this.verifySource(plan.source);
    };
    await guard();
    this.signingGuard = guard;
    try {
      return await this.manager.submit(quote);
    } finally {
      this.signingGuard = undefined;
    }
  }
}
