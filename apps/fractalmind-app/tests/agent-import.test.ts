import { fixtureCoreTypes } from "./helpers/type-origins";
import test from "node:test";
import assert from "node:assert/strict";
import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  normalizeSuiAddress as id,
  deriveDynamicFieldID,
  toBase64,
  fromBase64,
} from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import {
  HostIndexBcs,
  HostMembershipBcs,
  CoordinatorBindingBcs,
  ManagedAgentBcs,
  MemoryTransactionJournal,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { AgentImport, managedInstance } from "../src/agent-import";
import { ChainReadSession } from "../src/chain";
import { NativeDeviceSigner } from "../src/native-device";
import { OrganizationBcs } from "../src/device-identity";

const org = id("0xb1"),
  pkg = id("0xb2"),
  human = id("0xb3"),
  grant = id("0xb4"),
  bindingId = id("0xb5"),
  memberId = id("0xb6"),
  recordId = id("0xb7"),
  active = id("0xb8"),
  instances = id("0xb9");
const attempt = "00000000-0000-0000-0000-000000000001";
const Key = bcs.struct("InstanceKey", {
  host_address: bcs.Address,
  instance_id: bcs.string(),
});
const Pointer = bcs.struct("InstancePointer", {
  record_id: bcs.Address,
  membership_id: bcs.Address,
  runtime: bcs.string(),
  workspace_hash: bcs.vector(bcs.u8()),
  control_confirmed: bcs.bool(),
  revoked: bcs.bool(),
});
const Imported = bcs.struct("AgentImported", {
  org_id: bcs.Address,
  membership_id: bcs.Address,
  record_id: bcs.Address,
  instance_id: bcs.string(),
  duplicate: bcs.bool(),
});
async function fixture(
  rebind = false,
  controlled = false,
  rejoined = false,
  native = false,
) {
  const key = Ed25519Keypair.generate(),
    host = Ed25519Keypair.generate(),
    coordinator = Ed25519Keypair.generate(),
    now = Date.now();
  let signingMutation = () => {},
    quoteDigest = "";
  const device = await NativeDeviceSigner.load(async (command, args) => {
    if (command === "fm_device_sign_transaction") {
      signingMutation();
      return key.signTransaction(fromBase64(args.bytes));
    }
    assert.equal(command, "fm_device_public");
    return {
      format: 1,
      profile: args.profile,
      address: key.toSuiAddress(),
      signingPublicKey: key.getPublicKey().toBase64(),
      encryptionPublicKey: toBase64(new Uint8Array(32).fill(1)),
    };
  }, "test-import");
  const table = { id: id("0xba"), size: "0" };
  const organization = {
    id: org,
    name: "Fixture",
    description: "",
    admin: human,
    is_active: true,
    agents: table,
    agent_count: "0",
    tasks: table,
    task_count: "0",
    parent_org: null,
    child_orgs: table,
    child_org_count: "0",
    depth: "0",
    created_at: "1",
  };
  const binding = {
    id: bindingId,
    org_id: org,
    coordinator_address: coordinator.toSuiAddress(),
    public_key: Array.from(coordinator.getPublicKey().toRawBytes()),
    endpoint: "http://127.0.0.1:19090",
    version: "1",
    revoked: false,
  };
  const member = {
    id: memberId,
    org_id: org,
    host_address: host.toSuiAddress(),
    host_public_key: Array.from(host.getPublicKey().toRawBytes()),
    encryption_public_key: Array(32).fill(1),
    name: "Host",
    coordinator_binding: bindingId,
    version: "1",
    revoked: false,
    expires_at_ms: String(now + 86400000),
    joined_at_ms: String(now),
    source_invite: id("0xbb"),
    observation_capability: id("0xbc"),
  };
  const selected = {
    bindingId,
    hostAddress: host.toSuiAddress(),
    instanceId: (native ? "native-" : "tmux-") + "a".repeat(64),
    workspaceHash: "b".repeat(64),
  };
  const record = {
    id: recordId,
    org_id: org,
    membership_id: memberId,
    host_address: selected.hostAddress,
    instance_id: selected.instanceId,
    runtime: native ? "bounded-process-v1" : "tmux-observe",
    workspace_hash: Array(32).fill(0xbb),
    control_confirmed: false,
    confirmed_by_human: human,
    confirmed_by_device: device.device.address,
    version: "1",
    revoked: false,
    imported_at_ms: String(now),
  };
  const index = {
    bindings: [bindingId],
    invitations: [],
    memberships: [memberId],
    active_hosts: { id: active, size: "1" },
    instances: { id: instances, size: "0" },
  };
  let exists = false,
    mode = "normal",
    authority = "current",
    prepares = 0,
    submits = 0,
    reads = 0,
    authorityReads = 0;
  let prior: SelfPayTransactionOutcome | undefined;
  const core = {
    getObject: async ({ objectId }: { objectId: string }) => {
      const sources = {
        [org]: {
          type: `${pkg}::organization::Organization`,
          content: OrganizationBcs.serialize(organization).toBytes(),
        },
        [bindingId]: {
          type: `${pkg}::host::CoordinatorBinding`,
          content: CoordinatorBindingBcs.serialize(binding).toBytes(),
        },
        [memberId]: {
          type: `${pkg}::host::HostMembership`,
          content: HostMembershipBcs.serialize(member).toBytes(),
        },
        [recordId]: {
          type: `${pkg}::host::ManagedAgent`,
          content: ManagedAgentBcs.serialize(record).toBytes(),
        },
      };
      assert.ok(sources[objectId], objectId);
      return {
        object: {
          objectId,
          version: "1",
          owner: {
            $kind:
              mode === "owned-record" && objectId === recordId
                ? "AddressOwner"
                : "Shared",
          },
          ...sources[objectId],
        },
      };
    },
    getDynamicField: async ({
      parentId,
      name,
    }: {
      parentId: string;
      name: { type: string; bcs: Uint8Array };
    }) => {
      if (parentId === org)
        return {
          dynamicField: {
            value: {
              type: `${pkg}::host::HostIndex`,
              bcs: HostIndexBcs.serialize(index).toBytes(),
            },
          },
        };
      if (parentId === active)
        return {
          dynamicField: {
            value: {
              type: `${id("0x2")}::object::ID`,
              bcs: bcs.Address.serialize(
                mode === "pointer-replaced" ? id("0xbd") : memberId,
              ).toBytes(),
            },
          },
        };
      assert.equal(parentId, instances);
      const parsed = Key.parse(name.bcs);
      if (mode === "offline") throw new Error("RPC offline");
      if (
        !exists ||
        parsed.host_address !== selected.hostAddress ||
        parsed.instance_id !== selected.instanceId
      )
        throw {
          reason: "notFound",
          objectId:
            mode === "wrong-absence"
              ? id("0xbe")
              : deriveDynamicFieldID(
                  parentId,
                  TypeTagSerializer.parseFromStr(name.type),
                  name.bcs,
                ),
        };
      return {
        dynamicField: {
          value: {
            type: `${pkg}::host::InstancePointer`,
            bcs: Pointer.serialize({
              record_id: recordId,
              membership_id: record.membership_id,
              runtime: record.runtime,
              workspace_hash: record.workspace_hash,
              control_confirmed: record.control_confirmed,
              revoked: record.revoked,
            }).toBytes(),
          },
        },
      };
    },
  };
  const chain = {
    profile: { network: "localnet", humanId: human },
    checkNetwork: async () => "TestChain",
    human: async () => ({
      human: { organizations: [org] },
      clockMs: BigInt(now),
      loadedAtMs: Date.now(),
    }),
    sdk: {
      client: {
        ...fixtureCoreTypes(pkg),
        typesPackageId: pkg,
        packageId: pkg,
        client: { core },
      },
      host: {
        rebindAgent: (input: any) => {
          assert.equal(input.controlConfirmed, false);
          assert.equal(
            input.runtime,
            native ? "bounded-process-v1" : "tmux-observe",
          );
          assert.equal(input.managedAgentId, recordId);
          assert.equal(input.expectedVersion, "1");
          assert.equal(input.membershipId, memberId);
          assert.deepEqual(
            Array.from(input.workspaceHash),
            Array(32).fill(0xbb),
          );
          return new Transaction();
        },
        importAgent: (input: any) => {
          assert.equal(input.controlConfirmed, false);
          assert.equal(
            input.runtime,
            native ? "bounded-process-v1" : "tmux-observe",
          );
          assert.equal(input.membershipId, memberId);
          assert.equal(input.workspaceHash.length, 32);
          return new Transaction();
        },
      },
    },
  } as unknown as ChainReadSession;
  if (controlled) {
    record.runtime = "bounded-process-v1";
    record.control_confirmed = true;
  }
  if (rejoined) {
    record.membership_id = id("0xfd");
    record.workspace_hash = Array(32).fill(0xaa);
  }
  const controller = new AgentImport(
    chain,
    device,
    grant,
    org,
    new MemoryTransactionJournal(),
    rebind
      ? { kind: "rebind", reviewed: { ...record, revoked: true } }
      : undefined,
  );
  if (rebind) {
    exists = true;
    record.revoked = true;
  }
  // This fixture targets source pin/quote/receipt behavior. Actual device and
  // Host signature validation is exercised by the real Sui/socket integration.
  (controller as any).verifier.verifyOrganization = async () => {
    authorityReads++;
    return { authorityPin: authority, clockMs: BigInt(now) };
  };
  (controller as any).reads.readHosts = async () => {
    reads++;
    const valid = mode !== "unknown-host";
    return [
      {
        address: selected.hostAddress,
        state: valid ? "verified" : "unknown",
        membershipId: memberId,
        freshUntilMs: Date.now() + 60000,
        [native ? "nativeDiscovery" : "discovery"]: {
          state: mode === "failed-scan" ? "unavailable" : "complete",
          freshUntilMs:
            mode === "expired-scan" ? Date.now() - 1 : Date.now() + 60000,
          instances:
            mode === "missing-instance"
              ? []
              : [
                  {
                    instanceId: selected.instanceId,
                    state:
                      mode === "unverified-instance"
                        ? "unverified"
                        : "observed",
                    runtime: native ? "bounded-process-v1" : "tmux-observe",
                    continuity: native
                      ? "envd-process-v1"
                      : "kernel-process-v1",
                    workspaceHash:
                      mode === "changed-workspace"
                        ? "c".repeat(64)
                        : selected.workspaceHash,
                    pane: native ? "" : "%1",
                  },
                ],
        },
      },
    ];
  };
  controller.manager.query = async () => prior;
  controller.manager.prepare = async ({ requestId }) => {
    prepares++;
    if (mode === "change-during-quote") authority = "changed";
    return Object.freeze({
      requestId,
      digest: quoteDigest,
      expiresAtMs: Date.now() + 60000,
    }) as any;
  };
  controller.manager.submit = async () => {
    submits++;
    return {
      status: "unknown",
      digest: "original",
      requestId: `agent-import:${attempt}`,
      journalSynced: true,
    };
  };
  const outcome = {
    status: "confirmed",
    requestId: `agent-import:${attempt}`,
    digest: "original",
    transaction: {
      events: [
        {
          packageId: pkg,
          module: "host",
          sender: device.device.address,
          eventType: `${pkg}::host::AgentImported`,
          bcs: Imported.serialize({
            org_id: org,
            membership_id: memberId,
            record_id: recordId,
            instance_id: selected.instanceId,
            duplicate: false,
          }).toBytes(),
          json: null,
        },
      ],
      effects: {
        changedObjects: [
          {
            objectId: recordId,
            idOperation: "Created",
            outputState: "ObjectWrite",
            outputVersion: "1",
          },
        ],
      },
    },
  } as unknown as SelfPayTransactionOutcome;
  return {
    setSigningMutation: (fn: () => void) => (signingMutation = fn),
    setQuoteDigest: (digest: string) => (quoteDigest = digest),
    controller,
    chain,
    selected,
    record,
    binding,
    member,
    outcome,
    setExists: (v: boolean) => (exists = v),
    setMode: (v: string) => (mode = v),
    setAuthority: (v: string) => (authority = v),
    setPrior: (v: SelfPayTransactionOutcome) => (prior = v),
    counts: () => ({ prepares, submits, reads, authorityReads }),
  };
}
test("observation import requires confirmation, preserves control=false, and quotes separately from submission", async () => {
  const f = await fixture();
  await assert.rejects(
    f.controller.prepare(f.selected, attempt, false),
    /confirmation_required/,
  );
  assert.equal(f.counts().prepares, 0);
  const quote = await f.controller.prepare(f.selected, attempt, true);
  assert.ok(!("status" in quote));
  assert.equal(f.counts().submits, 0);
  await f.controller.submit(quote);
  assert.equal(f.counts().submits, 1);
});
test("expired, missing, unverified and changed-workspace discoveries never quote an import", async () => {
  for (const mode of [
    "unknown-host",
    "failed-scan",
    "expired-scan",
    "missing-instance",
    "unverified-instance",
    "changed-workspace",
  ]) {
    const f = await fixture();
    f.setMode(mode);
    await assert.rejects(
      f.controller.prepare(f.selected, attempt, true),
      /discovery_unavailable/,
    );
    assert.equal(f.counts().prepares, 0, mode);
    assert.equal(f.counts().submits, 0, mode);
  }
});
test("source or management changes after quotation stop the new broadcast", async () => {
  for (const mode of [
    "changed-workspace",
    "unknown-host",
    "revoked-member",
    "authority",
  ]) {
    const f = await fixture();
    const q = await f.controller.prepare(f.selected, attempt, true);
    assert.ok(!("status" in q));
    if (mode === "revoked-member") f.member.revoked = true;
    else if (mode === "authority") f.setAuthority("changed");
    else f.setMode(mode);
    await assert.rejects(f.controller.submit(q));
    assert.equal(f.counts().submits, 0, mode);
  }
  const f = await fixture();
  f.setMode("change-during-quote");
  await assert.rejects(
    f.controller.prepare(f.selected, attempt, true),
    /state_changed/,
  );
  assert.equal(f.counts().submits, 0);
});
test("exact existing pointer prevents duplicate fee; different Hosts do not merge the instance", async () => {
  const f = await fixture();
  f.setExists(true);
  const value = await f.controller.prepare(f.selected, attempt, true);
  assert.ok("status" in value && value.status === "already-imported");
  assert.equal(value.record.id, f.record.id);
  assert.equal(f.counts().prepares, 0);
  assert.equal(f.counts().reads, 0);
  assert.equal(
    await managedInstance(f.chain, org, id("0xcf"), f.selected.instanceId),
    null,
  );
  for (const mode of ["owned-record", "pointer-replaced"]) {
    const g = await fixture();
    g.setExists(true);
    g.setMode(mode);
    await assert.rejects(g.controller.prepare(g.selected, attempt, true));
    assert.equal(g.counts().prepares, 0);
  }
});
test("RPC failure and wrong missing-field identity are never interpreted as an empty directory", async () => {
  for (const mode of ["offline", "wrong-absence"]) {
    const f = await fixture();
    f.setMode(mode);
    await assert.rejects(f.controller.prepare(f.selected, attempt, true));
    assert.equal(f.counts().prepares, 0);
  }
  const f = await fixture();
  f.setExists(true);
  f.record.org_id = id("0xdd");
  await assert.rejects(
    managedInstance(
      f.chain,
      org,
      f.selected.hostAddress,
      f.selected.instanceId,
    ),
    /invalid_source/,
  );
});
test("original transaction outcome is queried before authority, scans or replacement input", async () => {
  const f = await fixture();
  f.setPrior(f.outcome);
  f.setMode("offline");
  const value = await f.controller.prepare({} as any, attempt, false);
  assert.equal(value, f.outcome);
  assert.equal(f.counts().authorityReads, 0);
  assert.equal(f.counts().reads, 0);
  assert.equal(f.counts().prepares, 0);
});
test("cancelled and superseded quotes cannot submit; confirmed receipt reconstructs without local selection", async () => {
  const f = await fixture();
  const q = await f.controller.prepare(f.selected, attempt, true);
  assert.ok(!("status" in q));
  f.controller.cancel(q);
  await assert.rejects(f.controller.submit(q), /invalid_quote/);
  const older = await f.controller.prepare(f.selected, attempt, true),
    newer = await f.controller.prepare(f.selected, attempt, true);
  assert.ok(!("status" in older) && !("status" in newer));
  await assert.rejects(f.controller.submit(older), /invalid_quote/);
  f.setExists(true);
  f.member.revoked = true;
  f.record.revoked = true;
  const record = await f.controller.confirmed(f.outcome);
  assert.equal(record.id, f.record.id);
  assert.equal(record.revoked, true);
});

test("switching physical instances disposes the old quote and prevents even a late pre-broadcast continuation", async () => {
  const f = await fixture();
  const quote = await f.controller.prepare(f.selected, attempt, true);
  assert.ok(!("status" in quote));
  f.controller.dispose();
  await assert.rejects(f.controller.submit(quote), /invalid_quote/);
  await assert.rejects(
    f.controller.prepare(f.selected, attempt, true),
    /state_changed/,
  );
  assert.throws(
    () => (f.controller.manager as any).options.assertBeforeBroadcast(),
    /state_changed/,
  );
});

test("a v2 target never inherits a valid historical receipt for a different Host, instance or workspace", async () => {
  const f = await fixture();
  f.setExists(true);
  assert.equal(
    (await f.controller.confirmed(f.outcome, f.selected)).id,
    f.record.id,
  );
  for (const changed of [
    { ...f.selected, hostAddress: id("0xef") },
    { ...f.selected, instanceId: `tmux-${"f".repeat(64)}` },
    { ...f.selected, workspaceHash: "f".repeat(64) },
  ])
    await assert.rejects(
      f.controller.confirmed(f.outcome, changed),
      /state_changed/,
    );
  // Legacy recovery is intentionally only a query of the actual old record.
  assert.equal((await f.controller.confirmed(f.outcome)).id, f.record.id);
});
test("idempotent receipt reconstructs an existing record; foreign or forged event scope is rejected", async () => {
  const f = await fixture();
  f.setExists(true);
  const duplicate = structuredClone(f.outcome);
  duplicate.transaction!.events![0].bcs = Imported.serialize({
    org_id: org,
    membership_id: memberId,
    record_id: recordId,
    instance_id: f.selected.instanceId,
    duplicate: true,
  }).toBytes();
  f.record.confirmed_by_device = id("0xee");
  assert.equal((await f.controller.confirmed(duplicate)).id, recordId);
  for (const mutation of ["sender", "package", "type", "organization"]) {
    const outcome = structuredClone(duplicate),
      value = outcome.transaction!.events![0];
    if (mutation === "sender") value.sender = id("0xef");
    if (mutation === "package") value.packageId = id("0xef");
    if (mutation === "type")
      value.eventType = `${id("0xef")}::host::AgentImported`;
    if (mutation === "organization")
      value.bcs = Imported.serialize({
        org_id: id("0xef"),
        membership_id: memberId,
        record_id: recordId,
        instance_id: f.selected.instanceId,
        duplicate: true,
      }).toBytes();
    await assert.rejects(f.controller.confirmed(outcome), /invalid_source/);
  }
});
test("native signature wait cannot release a transaction after the authority, scan or quote is invalidated", async () => {
  for (const mode of ["valid", "authority", "workspace", "cancelled"]) {
    const f = await fixture(),
      tx = new Transaction();
    tx.setSender(f.controller.device.device.address);
    tx.setGasOwner(f.controller.device.device.address);
    tx.setGasPrice(1);
    tx.setGasBudget(200000000);
    tx.setGasPayment([
      {
        objectId: id("0xf1"),
        version: "1",
        digest: "11111111111111111111111111111111",
      },
    ]);
    const bytes = await tx.build();
    f.setQuoteDigest(await Transaction.from(bytes).getDigest());
    const q = await f.controller.prepare(f.selected, attempt, true);
    assert.ok(!("status" in q));
    f.setSigningMutation(() => {
      if (mode === "authority") f.setAuthority("changed");
      if (mode === "workspace") f.setMode("changed-workspace");
      if (mode === "cancelled") f.controller.cancel(q);
    });
    const signer = (f.controller.manager as any).options.signer;
    if (mode === "valid")
      assert.equal(
        (await signer.signTransaction(bytes)).bytes,
        toBase64(bytes),
      );
    else await assert.rejects(signer.signTransaction(bytes));
  }
});

test("rebind requires explicit review, pins the revoked record and retains observation-only scope", async () => {
  const f = await fixture(true);
  await assert.rejects(
    f.controller.prepare(f.selected, attempt, false),
    /confirmation_required/,
  );
  const quote = await f.controller.prepare(f.selected, attempt, true);
  assert.ok(!("status" in quote));
  assert.equal(quote.requestId, `agent-rebind:${attempt}`);
  assert.equal(f.counts().submits, 0);
  f.record.version = "2";
  await assert.rejects(f.controller.submit(quote), /state_changed/);
  assert.equal(f.counts().submits, 0);
});

test("rebind cannot replace the reviewed record, accept missing instances or use revoked device authority", async () => {
  for (const mode of [
    "missing-instance",
    "expired-scan",
    "unknown-host",
    "changed-workspace",
  ]) {
    const f = await fixture(true);
    f.setMode(mode);
    await assert.rejects(
      f.controller.prepare(f.selected, attempt, true),
      /discovery_unavailable/,
    );
    assert.equal(f.counts().submits, 0);
  }
  const f = await fixture(true);
  const quote = await f.controller.prepare(f.selected, attempt, true);
  assert.ok(!("status" in quote));
  f.setAuthority("revoked");
  await assert.rejects(f.controller.submit(quote), /state_changed/);
  assert.equal(f.counts().submits, 0);
});

test("rebind recovery queries the original request before a newly selected source", async () => {
  const f = await fixture(true);
  f.setPrior({
    ...f.outcome,
    status: "unknown",
    requestId: `agent-rebind:${attempt}`,
  });
  const recovered = await f.controller.prepare({} as any, attempt, false);
  assert.equal((recovered as any).requestId, `agent-rebind:${attempt}`);
  assert.equal(f.counts().reads, 0);
});

test("rebind receipts retain the original record and require exactly the next logical version", async () => {
  const f = await fixture(true);
  f.record.revoked = false;
  await assert.rejects(f.controller.confirmed(f.outcome), /state_changed/);
  f.record.version = "2";
  assert.equal((await f.controller.confirmed(f.outcome)).id, f.record.id);
  f.record.version = "3";
  await assert.rejects(f.controller.confirmed(f.outcome), /state_changed/);
});

test("an observation rebind refuses controlled records until a separate safe handover", async () => {
  const f = await fixture(true, true);
  await assert.rejects(
    f.controller.prepare(f.selected, attempt, true),
    /handover_required/,
  );
  assert.equal(f.counts().prepares, 0);
});

test("a changed record during native authorization cannot release a rebind signature", async () => {
  const f = await fixture(true),
    tx = new Transaction();
  tx.setSender(f.controller.device.device.address);
  tx.setGasOwner(f.controller.device.device.address);
  tx.setGasPrice(1);
  tx.setGasBudget(200000000);
  tx.setGasPayment([
    {
      objectId: id("0xf1"),
      version: "1",
      digest: "11111111111111111111111111111111",
    },
  ]);
  const bytes = await tx.build();
  f.setQuoteDigest(await Transaction.from(bytes).getDigest());
  const quote = await f.controller.prepare(f.selected, attempt, true);
  assert.ok(!("status" in quote));
  f.setSigningMutation(() => {
    f.record.version = "2";
  });
  await assert.rejects(
    (f.controller.manager as any).options.signer.signTransaction(bytes),
    /state_changed/,
  );
});

test("observation rebind reviews previous membership/workspace but uses the freshly verified source", async () => {
  const f = await fixture(true, false, true);
  assert.notEqual(f.record.membership_id, f.member.id);
  assert.notEqual(f.record.workspace_hash[0], 0xbb);
  const quote = await f.controller.prepare(f.selected, attempt, true);
  assert.ok(!("status" in quote));
  assert.equal(f.counts().prepares, 1);
  assert.equal(f.counts().submits, 0);
});

test("native file instances import and explicitly rebind for observation without granting control", async () => {
  for (const rebind of [false, true]) {
    const f = await fixture(rebind, false, false, true);
    const quote = await f.controller.prepare(f.selected, attempt, true);
    assert.ok(!("status" in quote));
    assert.equal(f.counts().prepares, 1);
    f.setExists(true);
    f.record.revoked = false;
    if (rebind) f.record.version = "2";
    const record = await f.controller.confirmed(f.outcome, f.selected);
    assert.equal(record.runtime, "bounded-process-v1");
    assert.equal(record.control_confirmed, false);
    assert.equal(record.instance_id, f.selected.instanceId);
    f.controller.dispose();
  }
});
test("native selection cannot use tmux inventory or survive missing and stale native scans", async () => {
  for (const mode of [
    "expired-scan",
    "failed-scan",
    "missing-instance",
    "changed-workspace",
    "unknown-host",
  ]) {
    const f = await fixture(false, false, false, true);
    f.setMode(mode);
    await assert.rejects(
      f.controller.prepare(f.selected, attempt, true),
      /discovery_unavailable/,
    );
    assert.equal(f.counts().prepares, 0);
    f.controller.dispose();
  }
  const f = await fixture(false, false, false, true);
  (f.controller as any).reads.readHosts = async () => [
    {
      address: f.selected.hostAddress,
      state: "verified",
      membershipId: memberId,
      freshUntilMs: Date.now() + 60000,
      discovery: {
        state: "complete",
        freshUntilMs: Date.now() + 60000,
        instances: [
          {
            instanceId: f.selected.instanceId,
            state: "observed",
            runtime: "bounded-process-v1",
            continuity: "envd-process-v1",
            workspaceHash: f.selected.workspaceHash,
          },
        ],
      },
    },
  ];
  await assert.rejects(
    f.controller.prepare(f.selected, attempt, true),
    /discovery_unavailable/,
  );
  assert.equal(f.counts().prepares, 0);
});
