import { fromBase64, toBase64 } from "@mysten/sui/utils";
import type { Transaction } from "@mysten/sui/transactions";
import {
  NativeFileOkrRunner,
  bytesToHex,
  SelfPayTransactionManager,
  createSelfPayOkrSubmitter,
  okrRunnerTicketName,
  PRODUCT_RECORD_KINDS,
  type OkrRunnerRecord,
  type OkrRunnerTicketContext,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import {
  NativeCommandResults,
  type CommandResultTarget,
} from "./command-results";
import { CoordinatorReadClient } from "./coordinator-read";
import { DeviceIdentityVerifier } from "./device-identity";
import { canonical } from "./handover-plan";
import {
  NativeDeviceSigner,
  call,
  scopedNativeInvoke,
  type NativeInvoke,
} from "./native-device";
import { PrivateRecords } from "./private-records";
import { readRecordPointer } from "./record-pointer";

export class NativeOkrRunnerError extends Error {
  constructor(
    readonly code:
      | "invalid_source"
      | "state_changed"
      | "invalid_ciphertext"
      | "invalid_transaction",
  ) {
    super(code);
  }
}
const id = /^0x[0-9a-f]{64}$/;
const outcome = (value: SelfPayTransactionOutcome) => ({
  status: value.status === "failed" ? ("rejected" as const) : value.status,
  digest: value.digest,
  reason: value.reason,
});
/** Preserve the original receipt for ephemeral fee/result display. Later RPC
 * pruning can make a query unknown without erasing this confirmed receipt. */
class RunnerTransactionManager extends SelfPayTransactionManager {
  lastSubmission?: SelfPayTransactionOutcome;
  override async submit(quote: SelfPayFeeQuote) {
    const result = await super.submit(quote);
    this.lastSubmission = result;
    return result;
  }
}

/** Native bridge for the bounded sequential runner. Keys never enter the
 * WebView. Caller supplies explicit fee confirmation; restored queued work
 * stays read-only until releaseQueued is explicitly selected. Approval and
 * control-capability issuance are separate prior operations. */
export class NativeOkrRunner {
  private readonly manager: RunnerTransactionManager;
  private readonly verifier: DeviceIdentityVerifier;
  private readonly records: PrivateRecords;
  private readonly results: NativeCommandResults;
  private readonly coordinator: CoordinatorReadClient;
  private readonly runner: NativeFileOkrRunner;
  private readonly guards = new WeakMap<Transaction, () => Promise<void>>();
  private signingGuard?: () => Promise<void>;
  private flight?: {
    okrId: string;
    result: ReturnType<NativeFileOkrRunner["step"]>;
  };
  private readonly invoke: NativeInvoke;

  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    invoke: NativeInvoke,
    journal: TransactionJournal,
    approveQuote: (quote: SelfPayFeeQuote) => Promise<boolean>,
    transport: typeof fetch = fetch,
    private readonly assertActive: () => void = () => {},
  ) {
    if (![grantId, organizationId].every((v) => id.test(v)))
      throw new NativeOkrRunnerError("invalid_source");
    this.invoke = scopedNativeInvoke(invoke, assertActive);
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.records = new PrivateRecords(
      chain,
      signer,
      grantId,
      organizationId,
      this.invoke,
    );
    this.results = new NativeCommandResults(
      chain,
      signer,
      grantId,
      organizationId,
      this.invoke,
    );
    this.coordinator = new CoordinatorReadClient(
      chain,
      signer,
      grantId,
      organizationId,
      transport,
    );
    this.manager = new RunnerTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      journal,
      assertBeforeBroadcast: assertActive,
      signer: {
        getPublicKey: () => signer.getPublicKey(),
        signTransaction: async (bytes) => {
          const guard = this.signingGuard;
          if (!guard) throw new NativeOkrRunnerError("invalid_transaction");
          await guard();
          const signed = await signer.signTransaction(bytes);
          await guard();
          return signed;
        },
      },
    });
    const submit = createSelfPayOkrSubmitter({
      manager: this.manager,
      gasBudget: 200000000n,
      approveQuote: async (quote) => {
        const guard = this.signingGuard;
        if (!guard) throw new NativeOkrRunnerError("invalid_transaction");
        await guard();
        const accepted = await approveQuote(quote);
        if (accepted) await guard();
        return accepted;
      },
    });
    this.runner = new NativeFileOkrRunner({
      sdk: chain.sdk,
      organizationId,
      humanId: chain.profile.humanId,
      grantId,
      signer: {
        getPublicKey: () => signer.getPublicKey(),
        sign: async (bytes) => {
          assertActive();
          const signature = await signer.sign(bytes);
          assertActive();
          return signature;
        },
      },
      discoverTicket: async (logicalId) => {
        assertActive();
        const found = await readRecordPointer(
          chain,
          organizationId,
          "checkpoint",
          logicalId,
        );
        assertActive();
        return {
          keyVersion: found.keyVersion,
          ticketId: found.pointer?.record_id,
        };
      },
      querySubmission: async ({ requestId }) => {
        const prior = await this.manager.query(requestId);
        assertActive();
        return prior ? outcome(prior) : undefined;
      },
      crypto: {
        decrypt: (record) => this.decrypt(record),
        encrypt: (plaintext, context) => this.encrypt(plaintext, context),
        prepareCommand: async (input) => {
          assertActive();
          const prepared = await this.results.prepare(
            {
              command: input.command,
              membershipId: input.membershipId,
              bindingId: input.bindingId,
              managedAgentId: input.managedAgentId,
            },
            { tx: input.tx, expectedKeyVersion: input.keyVersion },
          );
          const before = await this.policyPin(input);
          const guard = async () => {
            assertActive();
            await prepared.assertCurrent();
            if ((await this.policyPin(input)) !== before)
              throw new NativeOkrRunnerError("state_changed");
            assertActive();
          };
          await guard();
          this.guards.set(input.tx, guard);
          return prepared.transaction;
        },
      },
      submit: async (transaction, context) => {
        // The same manager is also queried by the runner before command signing.
        const prior = await this.manager.query(context.requestId);
        if (prior) return outcome(prior);
        const guard = this.guards.get(transaction);
        if (!guard || this.signingGuard)
          throw new NativeOkrRunnerError("invalid_transaction");
        await guard();
        this.signingGuard = guard;
        try {
          return await submit(transaction, context);
        } finally {
          this.signingGuard = undefined;
        }
      },
      deliver: async (command) => {
        assertActive();
        const okr = await chain.sdk.okr.getOkr(
          (command.payload.okr as { id: string }).id,
        );
        const member = await chain.sdk.host.getMembership(okr.membership_id!);
        const managed = await chain.sdk.host.getManagedAgent(
          okr.managed_agent!,
        );
        const target = {
          command,
          membershipId: member.id,
          bindingId: member.coordinator_binding,
          managedAgentId: managed.id,
        };
        const before = await this.policyPin(target);
        const preflight = await this.results.preflight(target);
        const request = await this.coordinator.prepareCommand(
          member.coordinator_binding,
          command,
        );
        await preflight();
        if ((await this.policyPin(target)) !== before)
          throw new NativeOkrRunnerError("state_changed");
        assertActive();
        await request.send();
        assertActive();
      },
    });
  }
  step(input: Parameters<NativeFileOkrRunner["step"]>[0]) {
    this.assertActive();
    if (this.flight) {
      if (this.flight.okrId !== input.okrId)
        throw new NativeOkrRunnerError("invalid_transaction");
      return this.flight.result;
    }
    const result = this.runner.step(input).finally(() => {
      this.flight = undefined;
    });
    this.flight = { okrId: input.okrId, result };
    return result;
  }
  get lastSubmission() {
    return this.manager.lastSubmission;
  }
  async query(okrId: string) {
    await this.chain.checkNetwork();
    const okr = await this.chain.sdk.okr.getOkr(okrId);
    if (okr.org_id !== this.organizationId)
      throw new NativeOkrRunnerError("invalid_source");
    return this.manager.query(
      okrRunnerTicketName(okr.id, okr.agreement_version, okr.next_kr),
    );
  }
  private async decrypt(record: OkrRunnerRecord) {
    this.assertActive();
    if (
      record.organization_id !== this.organizationId ||
      ![2, 5].includes(record.kind)
    )
      throw new NativeOkrRunnerError("invalid_source");
    const plaintext = await this.records.read({
      kind: record.kind,
      logicalId: record.logical_id,
      record_id: record.id,
      revision: record.revision,
      key_version: record.key_version,
    });
    try {
      this.assertActive();
      return plaintext;
    } catch (error) {
      plaintext.fill(0);
      throw error;
    }
  }
  private async encrypt(
    plaintext: Uint8Array,
    context: OkrRunnerTicketContext,
  ) {
    this.assertActive();
    if (
      context.organizationId !== this.organizationId ||
      context.revision !== "1"
    )
      throw new NativeOkrRunnerError("invalid_source");
    const before = await this.verifier.verifyOrganization(
      this.organizationId,
      "operate",
    );
    const head = await readRecordPointer(
      this.chain,
      this.organizationId,
      "checkpoint",
      context.logicalId,
    );
    if (
      !before.encryptedKeys ||
      head.pointer ||
      head.keyVersion !== context.keyVersion
    )
      throw new NativeOkrRunnerError("state_changed");
    const encrypted = await call(this.invoke, "fm_device_encrypt_record", {
      profile: this.signer.device.profile,
      record: JSON.stringify({
        network: this.chain.profile.network,
        encryptedKeys: before.encryptedKeys,
        organizationId: this.organizationId,
        kind: PRODUCT_RECORD_KINDS.checkpoint,
        logicalId: context.logicalId,
        revision: context.revision,
        keyVersion: context.keyVersion,
        plaintext: toBase64(plaintext),
      }),
    });
    let body: Uint8Array;
    try {
      if (typeof encrypted !== "string" || encrypted.length > 87384)
        throw new Error();
      body = fromBase64(encrypted);
      if (
        body.length < 32 ||
        body.length > 65536 ||
        toBase64(body) !== encrypted ||
        new TextDecoder().decode(body.slice(0, 4)) !== "FME1"
      )
        throw new Error();
    } catch {
      throw new NativeOkrRunnerError("invalid_ciphertext");
    }
    const after = await this.verifier.verifyOrganization(
      this.organizationId,
      "operate",
    );
    const current = await readRecordPointer(
      this.chain,
      this.organizationId,
      "checkpoint",
      context.logicalId,
    );
    if (
      after.authorityPin !== before.authorityPin ||
      current.pointer ||
      current.keyVersion !== context.keyVersion
    )
      throw new NativeOkrRunnerError("state_changed");
    this.assertActive();
    return body;
  }
  private async policyPin(input: CommandResultTarget) {
    const context = input.command.payload.okr as {
      id: string;
      agreement_version: string;
      kr_index: string;
    };
    const [okr, policy, budget, capability, binding, contract] =
      await Promise.all([
        this.chain.sdk.okr.getOkr(context.id),
        this.chain.sdk.handover.getPolicy(context.id),
        this.chain.sdk.okr.getBudget(context.id),
        this.chain.sdk.remoteAuthority.getCapability(
          input.command.capability.id,
        ),
        this.chain.sdk.host.getAuthorityBinding(input.command.capability.id),
        this.chain.sdk.okr.getCapabilityContract(input.command.capability.id),
      ]);
    if (
      okr.org_id !== this.organizationId ||
      okr.state !== 1 ||
      okr.agreement_version !== context.agreement_version ||
      okr.next_kr !== context.kr_index ||
      okr.managed_agent !== input.managedAgentId ||
      okr.membership_id !== input.membershipId ||
      BigInt(okr.expires_at_ms) <= BigInt(Date.now()) ||
      policy.agreement_version !== okr.agreement_version ||
      policy.managed_version !== okr.managed_version ||
      canonical(input.command.payload.handover_continue) !==
        canonical({
          approval_id: policy.approval_id,
          proposal_hash: bytesToHex(Uint8Array.from(policy.proposal_hash)),
          nonce: bytesToHex(Uint8Array.from(policy.nonce)),
        }) ||
      capability.revoked ||
      capability.delegate !== this.signer.device.address ||
      capability.revocationVersion.toString() !==
        input.command.capability.revocation_version ||
      binding.human_id !== this.chain.profile.humanId ||
      binding.device_grant !== this.grantId ||
      binding.membership_version !== okr.membership_version ||
      binding.managed_agent_version !== okr.managed_version ||
      contract.contract_id !== okr.id ||
      contract.agreement_version !== okr.agreement_version ||
      canonical(contract.boundary_hash) !== canonical(okr.boundary_hash)
    )
      throw new NativeOkrRunnerError("state_changed");
    return canonical([okr, policy, budget, capability, binding, contract]);
  }
}
