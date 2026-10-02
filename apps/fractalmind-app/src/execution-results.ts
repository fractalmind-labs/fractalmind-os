import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  CommandExecutionBcs,
  EncryptedRecordBcs,
  HostMembershipBcs,
  bytesToHex,
  nodeCommandIntentHash,
  verifySignedNodeCommand,
  verifyHandoverAcceptanceSignature,
  assertFreshHandoverAcceptance,
  type HandoverAcceptance,
  type HandoverProposal,
  type SignedNodeCommand,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { call, NativeDeviceSigner, type NativeInvoke } from "./native-device";

export class ExecutionResultError extends Error {
  constructor(
    readonly code:
      | "invalid_source"
      | "invalid_result"
      | "state_changed"
      | "invalid_review",
  ) {
    super(code);
  }
}
type Run = ReturnType<typeof CommandExecutionBcs.parse>;
export type ExecutionResult = {
  run: Run;
  recordId: string | null;
  transactionDigest: string | null;
  response: Record<string, unknown> | null;
};
const id = /^0x[0-9a-f]{64}$/;
const states = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "needs_confirmation",
  "cancelled",
];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExecutionResultError("invalid_result");
  return value as Record<string, unknown>;
}
const pin = (value: unknown) => JSON.stringify(value);
async function hash(bytes: Uint8Array) {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  );
}

/** Reads the original immutable result of one Run. Current device authority is
 * required even for history; Host revocation does not erase readable history.
 * No current record-head substitution, command delivery, signing or storage. */
export class NativeExecutionResults {
  private readonly verifier: DeviceIdentityVerifier;
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    private readonly invoke: NativeInvoke,
  ) {
    if (!id.test(organizationId))
      throw new ExecutionResultError("invalid_source");
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
  }
  private async run(executionId: string, managedAgentId: string) {
    const { object: source } =
      await this.chain.sdk.client.client.core.getObject({
        objectId: executionId,
        include: { content: true },
      });
    if (
      source.objectId !== executionId ||
      source.owner.$kind !== "Shared" ||
      source.type !==
        `${this.chain.sdk.client.typesPackageId}::node_execution::CommandExecution` ||
      !source.content
    )
      throw new ExecutionResultError("invalid_source");
    const run = CommandExecutionBcs.parse(source.content);
    if (
      run.id !== executionId ||
      run.org_id !== this.organizationId ||
      run.managed_agent !== managedAgentId ||
      run.state > 5 ||
      run.intent_hash.length !== 32 ||
      run.host_address !== run.node_id ||
      !/^(native|tmux)-[0-9a-f]{64}$/.test(run.agent_id)
    )
      throw new ExecutionResultError("invalid_source");
    return run;
  }
  async read(
    executionId: string,
    managedAgentId: string,
  ): Promise<ExecutionResult> {
    if (!id.test(executionId) || !id.test(managedAgentId))
      throw new ExecutionResultError("invalid_source");
    const before = await this.verifier.verifyOrganization(this.organizationId);
    const run = await this.run(executionId, managedAgentId);
    const assertCurrent = async () => {
      const after = await this.verifier.verifyOrganization(this.organizationId);
      if (
        before.authorityPin !== after.authorityPin ||
        pin(run) !== pin(await this.run(executionId, managedAgentId))
      )
        throw new ExecutionResultError("state_changed");
    };
    if (!run.result_record) {
      if (
        [2, 3, 4].includes(run.state) ||
        run.result_hash.length ||
        (run.state === 5 && (!run.stop_requested || run.attempt_id.length))
      )
        throw new ExecutionResultError("invalid_source");
      await assertCurrent();
      return { run, recordId: null, transactionDigest: null, response: null };
    }
    if (run.state < 2 || run.result_hash.length !== 32)
      throw new ExecutionResultError("invalid_source");
    const { object: source } =
      await this.chain.sdk.client.client.core.getObject({
        objectId: run.result_record,
        include: { content: true, previousTransaction: true },
      });
    if (
      source.objectId !== run.result_record ||
      source.owner.$kind !== "Immutable" ||
      !source.content ||
      source.type !==
        `${this.chain.sdk.client.typesPackageId}::product_record::EncryptedRecord`
    )
      throw new ExecutionResultError("invalid_source");
    const record = EncryptedRecordBcs.parse(source.content);
    const fingerprint = bytesToHex(Uint8Array.from(run.intent_hash));
    const body = Uint8Array.from(record.encrypted_body);
    if (
      record.id !== source.objectId ||
      record.organization_id !== this.organizationId ||
      record.kind !== 5 ||
      record.logical_id !== `command-${fingerprint}` ||
      record.revision !== "1" ||
      BigInt(record.key_version) < 1n ||
      record.previous !== null ||
      record.writer_human !== run.human_id ||
      record.writer_device !== run.host_address ||
      record.grant_id !== run.grant_id ||
      record.grant_version !== run.grant_version ||
      record.created_at_ms !== run.updated_at_ms ||
      body.length < 32 ||
      body.length > 65536 ||
      !["FME1", "FME2"].includes(new TextDecoder().decode(body.slice(0, 4))) ||
      (await hash(body)) !== bytesToHex(Uint8Array.from(run.result_hash))
    )
      throw new ExecutionResultError("invalid_source");
    if (body[3] === 50) {
      const key = await this.chain.sdk.nodeExecution.getResultKey(
        run.capability_id,
        Uint8Array.from(run.intent_hash),
        record.key_version,
      );
      if (
        key.org_id !== run.org_id ||
        key.membership_id !== run.membership_id ||
        key.host_address !== run.host_address ||
        key.key_version !== record.key_version ||
        key.wrapped_key.length !== 132 ||
        new TextDecoder().decode(
          Uint8Array.from(key.wrapped_key).slice(0, 4),
        ) !== "FMW1" ||
        new TextDecoder().decode(
          Uint8Array.from(key.wrapped_key).slice(68, 72),
        ) !== "FME1"
      )
        throw new ExecutionResultError("invalid_source");
    }
    const budget = await this.chain.sdk.nodeExecution.getReservationBudget(
      run.capability_id,
      Uint8Array.from(run.intent_hash),
    );
    if (
      budget.reservedAmount !== BigInt(run.budget_amount) ||
      budget.settled !== (run.state !== 4)
    )
      throw new ExecutionResultError("invalid_source");
    const result = await call(this.invoke, "fm_device_decrypt_record", {
      profile: this.signer.device.profile,
      record: JSON.stringify({
        network: this.chain.profile.network,
        encryptedKeys: before.encryptedKeys,
        organizationId: this.organizationId,
        kind: 5,
        logicalId: record.logical_id,
        revision: record.revision,
        keyVersion: record.key_version,
        encryptedBody: toBase64(body),
      }),
    });
    let plaintext: Uint8Array | undefined;
    try {
      if (typeof result !== "string" || result.length > 87340)
        throw new ExecutionResultError("invalid_result");
      plaintext = fromBase64(result);
      if (plaintext.length > 65504 || toBase64(plaintext) !== result)
        throw new ExecutionResultError("invalid_result");
      const value = object(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
      );
      const response = object(value.response),
        event = object(value.event),
        target = object(event.target);
      if (
        value.version !== "1" ||
        response.schema_version !== "1" ||
        response.adapter !== "agent-manager-runtime" ||
        response.command_id !== run.command_id ||
        response.operation !== run.action ||
        response.execution_id !== run.id ||
        response.execution_state !== states[run.state] ||
        (response.requires_confirmation === true) !== (run.state === 4) ||
        typeof response.ok !== "boolean" ||
        (response.ok && response.error !== null) ||
        (!response.ok && !response.error) ||
        (run.state === 2 && !response.ok) ||
        ([3, 5].includes(run.state) && response.ok) ||
        event.version !== "1" ||
        event.command_id !== run.command_id ||
        target.organization_id !== run.org_id ||
        target.node_id !== run.node_id ||
        target.agent_id !== run.agent_id
      )
        throw new ExecutionResultError("invalid_result");
      if (
        run.budget_asset &&
        run.state !== 4 &&
        event.type !== "runtime_rejected"
      ) {
        const spend = object(response.spend);
        if (
          spend.known !== true ||
          spend.asset !== run.budget_asset ||
          spend.amount !== budget.spentAmount.toString()
        )
          throw new ExecutionResultError("invalid_result");
      } else if (
        (!run.budget_asset || event.type === "runtime_rejected") &&
        budget.spentAmount !== 0n
      )
        throw new ExecutionResultError("invalid_result");
      await assertCurrent();
      // Digests come exclusively from immutable object provenance. Never trust
      // a transaction_digest embedded in the decrypted runtime response.
      const digest = source.previousTransaction ?? null;
      return {
        run,
        recordId: record.id,
        transactionDigest: digest,
        response: { ...response, transaction_digest: digest },
      };
    } catch (error) {
      if (error instanceof ExecutionResultError) throw error;
      throw new ExecutionResultError("invalid_result");
    } finally {
      plaintext?.fill(0);
    }
  }

  /** Authenticate the original review against a caller-retained signed command.
   * This proves historical Host acceptance only. Approval still needs current
   * membership/instance/spec/coverage/Clock and explicit fee confirmation. */
  async readReview(raw: {
    executionId: string;
    command: SignedNodeCommand;
    proposal: HandoverProposal;
  }) {
    const input = structuredClone(raw);
    await verifySignedNodeCommand(input.command);
    const c = input.command;
    if (
      c.action !== "status" ||
      c.scope !== "observation" ||
      pin(c.payload.handover_review) !== pin(input.proposal)
    )
      throw new ExecutionResultError("invalid_review");
    const result = await this.read(
      input.executionId,
      input.proposal.managed_agent_id,
    );
    const run = result.run;
    if (
      run.state !== 2 ||
      run.capability_id !== c.capability.id ||
      run.command_id !== c.command_id ||
      bytesToHex(Uint8Array.from(run.intent_hash)) !==
        bytesToHex(nodeCommandIntentHash(c)) ||
      run.delegate !== c.signer ||
      run.node_id !== c.target.node_id ||
      run.agent_id !== c.target.agent_id ||
      run.org_id !== c.target.organization_id ||
      run.nonce !== c.nonce ||
      run.idempotency_key !== c.idempotency_key ||
      run.capability_version !== c.capability.revocation_version ||
      run.issued_at_ms !== String(c.issued_at_ms) ||
      run.expires_at_ms !== String(c.expires_at_ms) ||
      run.budget_asset ||
      run.budget_amount !== "0"
    )
      throw new ExecutionResultError("invalid_review");
    const a = object(
      result.response?.handover_review,
    ) as unknown as HandoverAcceptance;
    if (
      a.execution_id !== run.id ||
      a.organization_id !== run.org_id ||
      a.human_id !== run.human_id ||
      a.grant_id !== run.grant_id ||
      a.membership_id !== run.membership_id ||
      a.host_address !== run.host_address ||
      a.instance_id !== run.agent_id
    )
      throw new ExecutionResultError("invalid_review");
    const { object: memberSource } =
      await this.chain.sdk.client.client.core.getObject({
        objectId: run.membership_id,
        include: { content: true },
      });
    if (
      memberSource.objectId !== run.membership_id ||
      memberSource.owner.$kind !== "Shared" ||
      !memberSource.content ||
      memberSource.type !==
        `${this.chain.sdk.client.typesPackageId}::host::HostMembership`
    )
      throw new ExecutionResultError("invalid_review");
    const member = HostMembershipBcs.parse(memberSource.content);
    if (
      member.id !== run.membership_id ||
      member.org_id !== run.org_id ||
      member.host_address !== run.host_address ||
      member.coordinator_binding !== a.binding_id ||
      member.host_public_key.length !== 32 ||
      !a.signature.startsWith(
        `ed25519:${bytesToHex(Uint8Array.from(member.host_public_key))}:`,
      )
    )
      throw new ExecutionResultError("invalid_review");
    await verifyHandoverAcceptanceSignature(a, run.host_address);
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
    );
    if (authority.clockMs > BigInt(Number.MAX_SAFE_INTEGER))
      throw new ExecutionResultError("invalid_review");
    assertFreshHandoverAcceptance(a, Number(authority.clockMs), input.proposal);
    assertFreshHandoverAcceptance(a, Date.now(), input.proposal);
    return { ...result, acceptance: structuredClone(a) };
  }
}
