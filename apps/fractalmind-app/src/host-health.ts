import {
  SelfPayTransactionManager,
  bytesToHex,
  nodeCommandIntentHash,
  signNodeCommand,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type SignedNodeCommand,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { NativeCommandResults } from "./command-results";
import { CoordinatorReadClient } from "./coordinator-read";
import { DeviceIdentityVerifier } from "./device-identity";
import { NativeExecutionResults } from "./execution-results";
import { hostDirectory } from "./host-admission";
import { NativeDeviceSigner, type NativeInvoke } from "./native-device";
import { awaitTransactionVisible } from "./transaction-visibility";

export class HostHealthError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "invalid_source"
      | "state_changed"
      | "invalid_quote"
      | "sync_pending"
      | "delivery_unknown"
      | "invalid_result",
  ) {
    super(code);
  }
}

export type HostProbe = {
  name: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
};
export type HostHealthResult =
  | { state: "pending" }
  | {
      state: "finished";
      ok: boolean;
      probes: HostProbe[];
      error: string | null;
    };

const id = /^0x[0-9a-f]{64}$/;
/** A health capability lives just long enough for one command. */
const CAPABILITY_TTL_MS = 10 * 60_000;
const COMMAND_TTL_MS = 4 * 60_000;

/** Host probe results as envd's health probes return them. Anything else is
 * not a probe result and is reported as invalid. */
export function parseHostProbes(result: unknown): HostProbe[] | null {
  if (!result || typeof result !== "object") return null;
  const value = result as { source?: unknown; probes?: unknown };
  if (value.source !== "host-health-probes" || !Array.isArray(value.probes))
    return null;
  const probes: HostProbe[] = [];
  for (const p of value.probes as Record<string, unknown>[]) {
    if (
      !p ||
      typeof p.name !== "string" ||
      typeof p.ok !== "boolean" ||
      !Number.isSafeInteger(p.exit_code) ||
      typeof p.stdout !== "string" ||
      typeof p.stderr !== "string" ||
      typeof p.truncated !== "boolean" ||
      !Number.isSafeInteger(p.duration_ms)
    )
      return null;
    probes.push({
      name: p.name,
      ok: p.ok,
      exitCode: p.exit_code as number,
      stdout: p.stdout,
      stderr: p.stderr,
      truncated: p.truncated,
      durationMs: p.duration_ms as number,
    });
  }
  return probes;
}

/** Runs one Host's configured health probes as an authorized, receipted
 * command: a single-use device capability limited to `health`, a prepared Run
 * with its result key, one Coordinator delivery, and the encrypted result read
 * back from the chain. Every transaction is quoted, signed and submitted
 * explicitly; an unknown delivery is only ever followed by reading the Run. */
export class NativeHostHealth {
  private readonly verifier: DeviceIdentityVerifier;
  private readonly results: NativeCommandResults;
  private readonly reader: NativeExecutionResults;
  private readonly coordinator: CoordinatorReadClient;
  private readonly manager: SelfPayTransactionManager;
  private readonly plans = new WeakMap<
    SelfPayFeeQuote,
    { guard: () => Promise<void>; command?: SignedNodeCommand }
  >();
  private signingGuard?: () => Promise<void>;
  private delivered = new Set<string>();
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly membershipId: string,
    invoke: NativeInvoke,
    journal: TransactionJournal,
    transport: typeof fetch = fetch,
  ) {
    if (![grantId, organizationId, membershipId].every((v) => id.test(v)))
      throw new HostHealthError("invalid_input");
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.results = new NativeCommandResults(
      chain,
      signer,
      grantId,
      organizationId,
      invoke,
    );
    this.reader = new NativeExecutionResults(
      chain,
      signer,
      grantId,
      organizationId,
      invoke,
    );
    this.coordinator = new CoordinatorReadClient(
      chain,
      signer,
      grantId,
      organizationId,
      transport,
    );
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      journal,
      signer: {
        getPublicKey: () => signer.getPublicKey(),
        signTransaction: async (bytes) => {
          const guard = this.signingGuard;
          if (!guard) throw new HostHealthError("invalid_quote");
          await guard();
          const signed = await signer.signTransaction(bytes);
          await guard();
          return signed;
        },
      },
    });
  }
  private async source() {
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "read",
    );
    const directory = await hostDirectory(this.chain, this.organizationId);
    const member = directory.memberships.find(
      (m) =>
        m.id === this.membershipId &&
        !m.revoked &&
        BigInt(m.expires_at_ms) > directory.clockMs,
    );
    const binding = directory.bindings.find(
      (b) => b.id === member?.coordinator_binding && !b.revoked,
    );
    if (!member || !binding) throw new HostHealthError("invalid_source");
    return {
      authority,
      directory,
      member,
      binding,
      pin: JSON.stringify([authority.authorityPin, member, binding]),
    };
  }
  /** Step 1: a capability for exactly one `health` observation on this Host,
   * delegated to this device. */
  async quoteCapability(requestId: string) {
    const before = await this.source();
    const expires =
      BigInt(Math.max(Date.now(), Number(before.directory.clockMs))) +
      BigInt(CAPABILITY_TTL_MS);
    const ceiling = BigInt(before.member.expires_at_ms);
    const guard = async () => {
      if ((await this.source()).pin !== before.pin)
        throw new HostHealthError("state_changed");
    };
    const transaction = this.chain.sdk.host.issueCapability({
      organizationId: this.organizationId,
      humanId: before.authority.humanId,
      grantId: this.grantId,
      membershipId: before.member.id,
      bindingId: before.binding.id,
      actions: ["health"],
      scope: "observation",
      maxUses: 1,
      expiresAtMs: expires < ceiling ? expires : ceiling,
    });
    const quote = await this.manager.prepare({
      requestId,
      transaction,
      gasBudget: 200000000n,
    });
    await guard();
    this.plans.set(quote, { guard });
    return quote;
  }
  async submit(quote: SelfPayFeeQuote) {
    const plan = this.plans.get(quote);
    if (!plan) throw new HostHealthError("invalid_quote");
    await plan.guard();
    this.signingGuard = plan.guard;
    let outcome: SelfPayTransactionOutcome;
    try {
      outcome = await this.manager.submit(quote);
    } finally {
      this.signingGuard = undefined;
    }
    if (
      outcome.status === "confirmed" &&
      !(await awaitTransactionVisible(this.chain, outcome))
    )
      throw new HostHealthError("sync_pending");
    return outcome;
  }
  private created(outcome: SelfPayTransactionOutcome, type: string) {
    const objects = outcome.transaction?.effects?.changedObjects.filter(
      (o) =>
        o.outputState === "ObjectWrite" &&
        o.idOperation === "Created" &&
        outcome.transaction?.objectTypes?.[o.objectId] === type,
    );
    if (
      outcome.status !== "confirmed" ||
      outcome.transaction?.digest !== outcome.digest ||
      objects?.length !== 1 ||
      !id.test(objects[0].objectId)
    )
      throw new HostHealthError("invalid_source");
    return objects[0].objectId;
  }
  /** The capability created by step 1, checked to be exactly what was asked. */
  async capability(outcome: SelfPayTransactionOutcome) {
    const capabilityId = this.created(
      outcome,
      await this.chain.sdk.client.coreType(
        "remote_authority",
        "RemoteCapability",
      ),
    );
    const s = await this.source();
    const cap =
      await this.chain.sdk.remoteAuthority.getCapability(capabilityId);
    if (
      cap.objectId !== capabilityId ||
      cap.revoked ||
      cap.parentId ||
      cap.orgId !== this.organizationId ||
      cap.nodeId !== s.member.host_address ||
      cap.agentId ||
      cap.delegate !== this.signer.device.address ||
      cap.scope !== "observation" ||
      JSON.stringify(cap.actions) !== '["health"]' ||
      cap.maxUses !== 1n ||
      cap.usesClaimed !== 0n ||
      cap.maxBudget !== 0n ||
      cap.budgetAsset ||
      cap.expiresAtMs <= s.directory.clockMs
    )
      throw new HostHealthError("invalid_source");
    return { id: capabilityId, revocationVersion: cap.revocationVersion };
  }
  /** Step 2: sign the node-wide health command and prepare its Run and result
   * key in one transaction. */
  async quoteCommand(
    capability: { id: string; revocationVersion: bigint },
    requestId: string,
  ) {
    const before = await this.source();
    const now = Math.max(Date.now(), Number(before.directory.clockMs));
    const command = await signNodeCommand(this.signer, {
      target: {
        organizationId: this.organizationId,
        nodeId: before.member.host_address,
        // An empty Agent ID leaves agent_id out of the signed envelope: a
        // node-wide command.
        agentId: "",
      },
      action: "health",
      scope: "observation",
      capability: {
        id: capability.id,
        revocationVersion: capability.revocationVersion,
      },
      payload: {},
      issuedAtMs: now,
      expiresAtMs: now + COMMAND_TTL_MS,
    });
    const prepared = await this.results.prepare({
      command,
      membershipId: before.member.id,
      bindingId: before.binding.id,
      managedAgentId: null,
    });
    const guard = async () => {
      await prepared.assertCurrent();
      if ((await this.source()).pin !== before.pin)
        throw new HostHealthError("state_changed");
    };
    const quote = await this.manager.prepare({
      requestId,
      transaction: prepared.transaction,
      gasBudget: 200000000n,
    });
    await guard();
    this.plans.set(quote, { guard, command });
    return { quote, command };
  }
  /** The Run created by step 2, bound to the signed command. */
  async run(outcome: SelfPayTransactionOutcome, command: SignedNodeCommand) {
    const runId = this.created(
      outcome,
      await this.chain.sdk.client.coreType(
        "node_execution",
        "CommandExecution",
      ),
    );
    const run = await this.chain.sdk.nodeExecution.getExecution(runId);
    if (
      run.org_id !== this.organizationId ||
      run.capability_id !== command.capability.id ||
      run.action !== "health" ||
      bytesToHex(Uint8Array.from(run.intent_hash)) !==
        bytesToHex(nodeCommandIntentHash(command))
    )
      throw new HostHealthError("invalid_source");
    return runId;
  }
  /** Step 3: one Coordinator delivery. An unknown reply means reading the Run,
   * never sending again. */
  async send(command: SignedNodeCommand) {
    if (this.delivered.has(command.command_id))
      throw new HostHealthError("delivery_unknown");
    const s = await this.source();
    const request = await this.coordinator.prepareCommand(
      s.binding.id,
      command,
    );
    this.delivered.add(command.command_id);
    return request.send();
  }
  /** Step 4: the Host's encrypted result, decrypted on this device. */
  async result(runId: string): Promise<HostHealthResult> {
    const read = await this.reader.read(runId, null);
    if (!read.response) return { state: "pending" };
    const response = read.response as {
      ok?: unknown;
      result?: unknown;
      error?: { message?: unknown } | null;
    };
    const probes = parseHostProbes(response.result);
    if (!probes || typeof response.ok !== "boolean")
      throw new HostHealthError("invalid_result");
    return {
      state: "finished",
      ok: response.ok,
      probes,
      error:
        response.ok || typeof response.error?.message !== "string"
          ? null
          : response.error.message,
    };
  }
}
