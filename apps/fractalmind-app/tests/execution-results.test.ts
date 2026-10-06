import { fixtureCoreTypes } from "./helpers/type-origins";
import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress as id, toBase64 } from "@mysten/sui/utils";
import {
  CommandExecutionBcs,
  EncryptedRecordBcs,
  HostMembershipBcs,
  commandResultKey,
  encryptCommandResult,
  decryptCommandResult,
  recordContext,
  signNodeCommand,
  nodeCommandIntentHash,
  handoverAcceptanceSigningBytes,
  bytesToHex,
  type HandoverProposal,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  NativeExecutionResults,
  ExecutionResultError,
} from "../src/execution-results";
import { NativeDeviceSigner } from "../src/native-device";
import type { ChainReadSession } from "../src/chain";

async function fixture(review = false) {
  const device = Ed25519Keypair.generate(),
    host = Ed25519Keypair.generate();
  const org = id("0x1"),
    pkg = id("0x2"),
    executionId = id("0x3"),
    managed = id("0x4");
  const now = Date.now(),
    root = new Uint8Array(32).fill(9);
  const proposal: HandoverProposal = {
    version: "1",
    managed_agent_id: managed,
    managed_version: "1",
    okr_id: id("0x8"),
    okr_version: "1",
    spec_revision: "1",
    workspace_hash: "aa".repeat(32),
    paths: { "file.read": ["."], "file.write": ["."], "file.list": ["."] },
    budget_asset: "TOOL_CALLS",
    budget_limit: "9",
    max_calls: "3",
    expires_at_ms: now + 3600000,
    nonce: "bb".repeat(32),
    review_expires_at_ms: now + 55000,
  };
  const command = await signNodeCommand(device, {
    target: {
      organizationId: org,
      nodeId: host.toSuiAddress(),
      agentId: "native-" + "22".repeat(32),
    },
    capability: { id: id("0x5"), revocationVersion: 1n },
    action: "status",
    scope: "observation",
    payload: review ? { handover_review: proposal } : {},
    expiresAtMs: now + 120000,
  });
  const fingerprint = bytesToHex(nodeCommandIntentHash(command));
  const run = {
    id: executionId,
    org_id: org,
    capability_id: command.capability.id,
    capability_version: "1",
    human_id: id("0x6"),
    grant_id: id("0x7"),
    grant_version: "1",
    membership_id: id("0xa"),
    host_address: host.toSuiAddress(),
    managed_agent: managed,
    delegate: device.toSuiAddress(),
    node_id: host.toSuiAddress(),
    agent_id: command.target.agent_id!,
    command_id: command.command_id,
    nonce: command.nonce,
    idempotency_key: command.idempotency_key,
    intent_hash: Array.from(nodeCommandIntentHash(command)),
    action: "status",
    scope: "observation",
    budget_asset: "",
    budget_amount: "0",
    issued_at_ms: String(command.issued_at_ms),
    expires_at_ms: String(command.expires_at_ms),
    state: 2,
    cursor: "2",
    stop_requested: false,
    created_at_ms: String(now),
    started_at_ms: String(now),
    updated_at_ms: String(now),
    result_record: id("0xb") as string | null,
    result_hash: [] as number[],
    attempt_id: Array(32).fill(1),
  };
  const response: Record<string, unknown> = {
    schema_version: "1",
    adapter: "agent-manager-runtime",
    command_id: command.command_id,
    operation: "status",
    duplicate: false,
    ok: true,
    observed_at: new Date(now).toISOString(),
    result: { status: "idle" },
    error: null,
    execution_id: executionId,
    execution_state: "succeeded",
    transaction_digest: "DO-NOT-TRUST-PLAINTEXT",
  };
  const member = {
    id: run.membership_id,
    org_id: org,
    host_address: host.toSuiAddress(),
    host_public_key: Array.from(host.getPublicKey().toRawBytes()),
    encryption_public_key: Array(32).fill(1),
    name: "Historical Host",
    coordinator_binding: id("0xc"),
    version: "1",
    revoked: false,
    expires_at_ms: String(now + 3600000),
    joined_at_ms: String(now),
    source_invite: id("0xd"),
    observation_capability: command.capability.id,
  };
  const value = {
    version: "1",
    response,
    event: {
      version: "1",
      command_id: command.command_id,
      target: { ...command.target },
      type: "runtime_completed",
      result_code: "runtime_completed",
      occurred_at_ms: now,
    },
  };
  if (review) {
    const acceptance = {
      version: "1" as const,
      execution_id: executionId,
      organization_id: org,
      human_id: run.human_id,
      grant_id: run.grant_id,
      membership_id: run.membership_id,
      binding_id: id("0xc"),
      host_address: host.toSuiAddress(),
      instance_id: run.agent_id,
      proposal,
      coverage_revision: "3",
      observed_at_ms: now,
      signature: "",
    };
    acceptance.signature = `ed25519:${bytesToHex(host.getPublicKey().toRawBytes())}:${bytesToHex(await host.sign(handoverAcceptanceSigningBytes(acceptance)))}`;
    response.handover_review = acceptance;
  }
  const record = {
    id: id("0xb"),
    organization_id: org,
    kind: 5,
    logical_id: `command-${fingerprint}`,
    revision: "1",
    key_version: "1",
    previous: null as string | null,
    writer_human: run.human_id,
    writer_device: host.toSuiAddress(),
    grant_id: run.grant_id,
    grant_version: "1",
    created_at_ms: String(now),
    encrypted_body: [] as number[],
  };
  async function encode() {
    const body = await encryptCommandResult(
      new TextEncoder().encode(JSON.stringify(value)),
      commandResultKey(root, org, fingerprint, "1"),
      recordContext(org, "checkpoint", record.logical_id, "1", "1"),
    );
    record.encrypted_body = Array.from(body);
    run.result_hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(body)),
      ),
    );
  }
  await encode();
  let authorityPin = "authority",
    sourceOwner = "Shared",
    recordOwner = "Immutable",
    afterDecrypt = () => {};
  let decrypts = 0,
    recordReads = 0;
  const wrapped = new Uint8Array(132);
  wrapped.set(new TextEncoder().encode("FMW1"));
  wrapped.set(new TextEncoder().encode("FME1"), 68);
  const keyGrant = {
    org_id: org,
    membership_id: run.membership_id,
    host_address: host.toSuiAddress(),
    key_version: "1",
    wrapped_key: Array.from(wrapped),
  };
  const budget = { reservedAmount: 0n, spentAmount: 0n, settled: true };
  const invoke = async (command: string, args: Record<string, string>) => {
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: args.profile,
        address: device.toSuiAddress(),
        signingPublicKey: device.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(new Uint8Array(32)),
      };
    assert.equal(command, "fm_device_decrypt_record");
    decrypts++;
    const request = JSON.parse(args.record);
    assert.equal(request.encryptedKeys, "opaque-current-grant");
    const plaintext = await decryptCommandResult(
      Uint8Array.from(record.encrypted_body),
      commandResultKey(root, org, fingerprint, "1"),
      recordContext(
        org,
        "checkpoint",
        request.logicalId,
        request.revision,
        request.keyVersion,
      ),
    );
    afterDecrypt();
    return toBase64(plaintext);
  };
  const chain = {
    profile: { network: "localnet" },
    sdk: {
      client: {
        ...fixtureCoreTypes(pkg),
        typesPackageId: pkg,
        client: {
          core: {
            getObject: async ({
              objectId,
              include,
            }: {
              objectId: string;
              include: any;
            }) => {
              if (objectId === member.id)
                return {
                  object: {
                    objectId,
                    owner: { $kind: "Shared" },
                    type: `${pkg}::host::HostMembership`,
                    content: HostMembershipBcs.serialize(member).toBytes(),
                  },
                };
              if (objectId === executionId)
                return {
                  object: {
                    objectId,
                    owner: { $kind: sourceOwner },
                    type: `${pkg}::node_execution::CommandExecution`,
                    content: CommandExecutionBcs.serialize(run).toBytes(),
                  },
                };
              assert.equal(objectId, record.id);
              assert.equal(include.previousTransaction, true);
              recordReads++;
              return {
                object: {
                  objectId,
                  owner: { $kind: recordOwner },
                  type: `${pkg}::product_record::EncryptedRecord`,
                  content: EncryptedRecordBcs.serialize(record).toBytes(),
                  previousTransaction: "CHAIN-CREATION-DIGEST",
                },
              };
            },
          },
        },
      },
      nodeExecution: {
        getResultKey: async () => keyGrant,
        getReservationBudget: async () => budget,
      },
    },
  } as unknown as ChainReadSession;
  const signer = await NativeDeviceSigner.load(invoke, "test-reader");
  const reader = new NativeExecutionResults(
    chain,
    signer,
    run.grant_id,
    org,
    invoke,
  );
  (reader as any).verifier.verifyOrganization = async () => ({
    authorityPin,
    clockMs: BigInt(now),
    encryptedKeys: "opaque-current-grant",
  });
  return {
    reader,
    run,
    record,
    response,
    member,
    value,
    command,
    proposal,
    keyGrant,
    budget,
    encode,
    executionId,
    managed,
    sourceOwner: (value: string) => (sourceOwner = value),
    recordOwner: (value: string) => (recordOwner = value),
    afterDecrypt: (fn: () => void) => (afterDecrypt = fn),
    revoke: () => (authorityPin = "revoked"),
    count: () => ({ decrypts, recordReads }),
  };
}
test("original immutable result decrypts; digest comes from chain, no current head or dispatch", async () => {
  const f = await fixture();
  const result = await f.reader.read(f.executionId, f.managed);
  assert.equal(result.transactionDigest, "CHAIN-CREATION-DIGEST");
  assert.equal(result.response?.transaction_digest, "CHAIN-CREATION-DIGEST");
  assert.deepEqual(result.response?.result, { status: "idle" });
  assert.equal(f.count().decrypts, 1);
});
test("ciphertext hash, ownership and exact Run record metadata are checked before native release", async () => {
  const cases: Array<(f: Awaited<ReturnType<typeof fixture>>) => void> = [
    (f) => f.sourceOwner("Immutable"),
    (f) => f.recordOwner("Shared"),
    (f) => (f.run.org_id = id("0xee")),
    (f) => (f.run.managed_agent = id("0xee")),
    (f) => (f.record.organization_id = id("0xee")),
    (f) => (f.record.writer_device = id("0xee")),
    (f) => (f.record.writer_human = id("0xee")),
    (f) => (f.record.grant_version = "2"),
    (f) => (f.record.created_at_ms = "1"),
    (f) => (f.record.previous = id("0xee")),
    (f) => (f.record.revision = "2"),
    (f) => (f.record.kind = 4),
    (f) => (f.record.logical_id = "command-" + "ff".repeat(32)),
    (f) => (f.run.result_hash[0] ^= 1),
    (f) => (f.keyGrant.membership_id = id("0xee")),
    (f) => (f.keyGrant.wrapped_key[0] ^= 1),
    (f) => (f.budget.settled = false),
    (f) => (f.budget.reservedAmount = 1n),
  ];
  for (const change of cases) {
    const f = await fixture();
    change(f);
    await assert.rejects(
      f.reader.read(f.executionId, f.managed),
      ExecutionResultError,
    );
    assert.equal(f.count().decrypts, 0);
  }
});
test("revocation or Run changes during native decrypt prevent plaintext publication", async () => {
  for (const change of ["revoke", "run"]) {
    const f = await fixture();
    f.afterDecrypt(() =>
      change === "revoke" ? f.revoke() : (f.run.cursor = "3"),
    );
    await assert.rejects(
      f.reader.read(f.executionId, f.managed),
      (e: unknown) =>
        e instanceof ExecutionResultError && e.code === "state_changed",
    );
  }
});
test("decrypted command/state/target/spend cannot disagree with chain evidence", async () => {
  for (const kind of ["command", "target", "state", "ok", "schema", "spend"]) {
    const f = await fixture();
    if (kind === "command") f.response.command_id = "different";
    if (kind === "target") f.value.event.target.node_id = id("0xee");
    if (kind === "state") f.response.execution_state = "failed";
    if (kind === "ok") f.response.ok = false;
    if (kind === "schema") f.response.schema_version = "2";
    if (kind === "spend") {
      f.run.budget_asset = "TOOL_CALLS";
      f.run.budget_amount = "3";
      f.budget.reservedAmount = 3n;
      f.response.spend = { asset: "TOOL_CALLS", known: true, amount: "1" };
    }
    await f.encode();
    await assert.rejects(
      f.reader.read(f.executionId, f.managed),
      ExecutionResultError,
    );
  }
});
test("unknown result retains reservation; pre-start cancellation has no fabricated body", async () => {
  const unknown = await fixture();
  unknown.run.state = 4;
  unknown.budget.settled = false;
  unknown.response.execution_state = "needs_confirmation";
  unknown.response.requires_confirmation = true;
  await unknown.encode();
  assert.equal(
    (await unknown.reader.read(unknown.executionId, unknown.managed)).run.state,
    4,
  );
  const cancelled = await fixture();
  cancelled.run.state = 5;
  cancelled.run.stop_requested = true;
  cancelled.run.result_record = null;
  cancelled.run.result_hash = [];
  cancelled.run.attempt_id = [];
  assert.equal(
    (await cancelled.reader.read(cancelled.executionId, cancelled.managed))
      .response,
    null,
  );
  assert.equal(cancelled.count().decrypts, 0);
  cancelled.run.state = 2;
  await assert.rejects(
    cancelled.reader.read(cancelled.executionId, cancelled.managed),
    ExecutionResultError,
  );
});
test("Host review is bound to original signed command and fresh proposal; forged proof fails", async () => {
  const f = await fixture(true);
  const input = {
    executionId: f.executionId,
    command: f.command,
    proposal: f.proposal,
  };
  assert.equal(
    (await f.reader.readReview(input)).acceptance.execution_id,
    f.executionId,
  );
  f.member.coordinator_binding = id("0xef");
  await assert.rejects(f.reader.readReview(input));
  f.member.coordinator_binding = id("0xc");
  f.member.host_public_key[0] ^= 1;
  await assert.rejects(f.reader.readReview(input));
  f.member.host_public_key[0] ^= 1;
  const changed = structuredClone(input);
  changed.proposal.max_calls = "2";
  await assert.rejects(f.reader.readReview(changed));
  (f.response.handover_review as any).signature =
    "ed25519:" + "00".repeat(32) + ":" + "00".repeat(64);
  await f.encode();
  await assert.rejects(f.reader.readReview(input));
});
