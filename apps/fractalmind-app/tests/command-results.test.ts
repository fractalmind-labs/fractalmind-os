import assert from "node:assert/strict";
import test from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress as id, toBase64 } from "@mysten/sui/utils";
import {
  CoordinatorBindingBcs,
  HostMembershipBcs,
  HostIndexBcs,
  ManagedAgentBcs,
  signNodeCommand,
  nodeCommandIntentHash,
  bytesToHex,
} from "@fractalmind-labs/fractalmind-sdk";
import { Transaction } from "@mysten/sui/transactions";
import {
  NativeCommandResults,
  CommandResultError,
  type CommandResultTarget,
} from "../src/command-results";
import { NativeDeviceSigner } from "../src/native-device";
import { OrganizationBcs } from "../src/device-identity";
import type { ChainReadSession } from "../src/chain";
const org = id("0x1"),
  pkg = id("0x2"),
  human = id("0x3"),
  grant = id("0x4"),
  memberId = id("0x5"),
  bindingId = id("0x6"),
  managedId = id("0x7"),
  active = id("0x8"),
  instances = id("0x9");
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
async function fixture(review = false) {
  const key = Ed25519Keypair.generate(),
    host = Ed25519Keypair.generate(),
    coordinator = Ed25519Keypair.generate();
  const instance = "native-" + "11".repeat(32),
    now = Date.now();
  const table = { id: id("0xa"), size: "0" };
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
  const member = {
    id: memberId,
    org_id: org,
    host_address: host.toSuiAddress(),
    host_public_key: Array.from(host.getPublicKey().toRawBytes()),
    encryption_public_key: Array(32).fill(7),
    name: "Host",
    coordinator_binding: bindingId,
    version: "1",
    revoked: false,
    expires_at_ms: String(now + 3600000),
    joined_at_ms: String(now),
    source_invite: id("0xb"),
    observation_capability: id("0xc"),
  };
  const binding = {
    id: bindingId,
    org_id: org,
    coordinator_address: coordinator.toSuiAddress(),
    public_key: Array.from(coordinator.getPublicKey().toRawBytes()),
    endpoint: "http://127.0.0.1:19000",
    version: "1",
    revoked: false,
  };
  const managed = {
    id: managedId,
    org_id: org,
    membership_id: memberId,
    host_address: host.toSuiAddress(),
    instance_id: instance,
    runtime: "bounded-process-v1",
    workspace_hash: Array(32).fill(8),
    control_confirmed: false,
    confirmed_by_human: human,
    confirmed_by_device: key.toSuiAddress(),
    version: "1",
    revoked: false,
    imported_at_ms: String(now),
  };
  let authorityPin = "current-authority",
    currentKey = "2",
    currentMember = memberId,
    chainClock = BigInt(now),
    duringNative = () => {},
    duringBuilder = () => {},
    wraps = 0,
    builds = 0,
    response = "",
    requested: any;
  const envelope = new Uint8Array(132);
  envelope.set(new TextEncoder().encode("FMW1"));
  envelope.set(new TextEncoder().encode("FME1"), 68);
  response = toBase64(envelope);
  const invoke = async (command: string, args: Record<string, string>) => {
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: args.profile,
        address: key.toSuiAddress(),
        signingPublicKey: key.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(new Uint8Array(32)),
      };
    assert.equal(command, "fm_device_wrap_command_result_key");
    wraps++;
    requested = JSON.parse(args.request);
    duringNative();
    return response;
  };
  const device = await NativeDeviceSigner.load(invoke, "test-results");
  const core = {
    getObject: async ({ objectId }: { objectId: string }) => {
      const sources: Record<string, { type: string; content: Uint8Array }> = {
        [org]: {
          type: `${pkg}::organization::Organization`,
          content: OrganizationBcs.serialize(organization).toBytes(),
        },
        [memberId]: {
          type: `${pkg}::host::HostMembership`,
          content: HostMembershipBcs.serialize(member).toBytes(),
        },
        [bindingId]: {
          type: `${pkg}::host::CoordinatorBinding`,
          content: CoordinatorBindingBcs.serialize(binding).toBytes(),
        },
        [managedId]: {
          type: `${pkg}::host::ManagedAgent`,
          content: ManagedAgentBcs.serialize(managed).toBytes(),
        },
      };
      assert.ok(sources[objectId]);
      return {
        object: {
          objectId,
          version: "1",
          owner: { $kind: "Shared" },
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
              bcs: HostIndexBcs.serialize({
                bindings: [bindingId],
                invitations: [],
                memberships: [memberId],
                active_hosts: { id: active, size: "1" },
                instances: { id: instances, size: "1" },
              }).toBytes(),
            },
          },
        };
      if (parentId === active) {
        assert.equal(name.type, "address");
        assert.equal(bcs.Address.parse(name.bcs), member.host_address);
        return {
          dynamicField: {
            value: {
              type: "0x2::object::ID",
              bcs: bcs.Address.serialize(currentMember).toBytes(),
            },
          },
        };
      }
      assert.equal(parentId, instances);
      const parsed = Key.parse(name.bcs);
      assert.equal(parsed.instance_id, instance);
      return {
        dynamicField: {
          value: {
            type: `${pkg}::host::InstancePointer`,
            bcs: Pointer.serialize({
              record_id: managedId,
              membership_id: managed.membership_id,
              runtime: managed.runtime,
              workspace_hash: managed.workspace_hash,
              control_confirmed: managed.control_confirmed,
              revoked: managed.revoked,
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
      clockMs: chainClock,
      loadedAtMs: Date.now(),
    }),
    sdk: {
      client: { typesPackageId: pkg, client: { core } },
      productRecord: { listCurrent: async () => ({ keyVersion: currentKey }) },
      nodeExecution: {
        prepareCommand: async (input: any) => {
          builds++;
          assert.equal(input.resultKey.organizationKey, undefined);
          assert.equal(
            input.resultKey.intentHash,
            bytesToHex(nodeCommandIntentHash(input.command)),
          );
          assert.equal(input.resultKey.wrappedKey.length, 132);
          assert.equal(input.managedAgentId, managedId);
          duringBuilder();
          return new Transaction();
        },
      },
    },
  } as unknown as ChainReadSession;
  const controller = new NativeCommandResults(
    chain,
    device,
    grant,
    org,
    invoke,
  );
  let actions = ["read", "operate", "approve", "manage_hosts"],
    required = "";
  (controller as any).verifier.verifyOrganization = async (
    _: string,
    action: string,
  ) => {
    required = action;
    if (!actions.includes(action)) throw new Error("invalid_grant");
    return { authorityPin, actions, encryptedKeys: "encrypted-ring" };
  };
  const command = await signNodeCommand(key, {
    target: {
      organizationId: org,
      nodeId: host.toSuiAddress(),
      agentId: instance,
    },
    action: "status",
    scope: "observation",
    capability: { id: id("0xd"), revocationVersion: 1n },
    expiresAtMs: now + 60000,
    payload: review ? { handover_review: { version: "1" } } : {},
  });
  const input: CommandResultTarget = {
    command,
    membershipId: memberId,
    bindingId,
    managedAgentId: managedId,
  };
  return {
    controller,
    input,
    member,
    managed,
    binding,
    counts: () => ({ wraps, builds, required, requested }),
    native: (f: () => void) => {
      duringNative = f;
    },
    builder: (f: () => void) => {
      duringBuilder = f;
    },
    pin: () => {
      authorityPin = "changed";
    },
    rotate: () => {
      currentKey = "3";
    },
    replaceMember: () => {
      currentMember = id("0xff");
    },
    expire: () => {
      chainClock = BigInt(command.expires_at_ms);
    },
    actions: (v: string[]) => {
      actions = v;
    },
    response: (v: string) => {
      response = v;
    },
  };
}
test("App prepares native result ciphertext under current exact Host and retains a broadcast preflight", async () => {
  const f = await fixture(true),
    prepared = await f.controller.prepare(f.input);
  assert.deepEqual(f.counts().wraps, 1);
  assert.equal(f.counts().builds, 1);
  assert.equal(f.counts().required, "approve");
  assert.equal(f.counts().requested.keyVersion, "2");
  assert.equal(f.counts().requested.membershipId, memberId);
  assert.equal(f.counts().requested.organizationKey, undefined);
  assert.ok(prepared.transaction);
  await prepared.assertCurrent();
  f.pin();
  await assert.rejects(prepared.assertCurrent(), /state_changed/);
});
test("existing-command preflight reads exact current pointers without key wrapping or new transaction construction", async () => {
  const f = await fixture(true),
    assertCurrent = await f.controller.preflight(f.input);
  await assertCurrent();
  assert.equal(f.counts().wraps, 0);
  assert.equal(f.counts().builds, 0);
  f.replaceMember();
  await assert.rejects(assertCurrent());
  assert.equal(f.counts().wraps, 0);
  assert.equal(f.counts().builds, 0);
});
test("changes while native wrapping waits cannot produce a transaction", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => f.pin(),
    (f: Awaited<ReturnType<typeof fixture>>) => f.rotate(),
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.member.encryption_public_key[0]++;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.managed.version = "2";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.managed.workspace_hash[0]++;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.member.revoked = true;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.binding.revoked = true;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => f.replaceMember(),
    (f: Awaited<ReturnType<typeof fixture>>) => f.expire(),
  ]) {
    const f = await fixture();
    f.native(() => mutate(f));
    await assert.rejects(f.controller.prepare(f.input));
    assert.equal(f.counts().builds, 0);
  }
  const f = await fixture();
  f.builder(() => f.rotate());
  await assert.rejects(f.controller.prepare(f.input), /state_changed/);
});
test("expired sources, substituted commands and missing review rights fail before native wrapping", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.input.command.payload.extra = true;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.input.managedAgentId = id("0xff");
    },
    (f: Awaited<ReturnType<typeof fixture>>) => f.expire(),
    (f: Awaited<ReturnType<typeof fixture>>) => f.replaceMember(),
    (f: Awaited<ReturnType<typeof fixture>>) => f.actions(["read", "approve"]),
  ]) {
    const f = await fixture(true);
    mutate(f);
    await assert.rejects(f.controller.prepare(f.input));
    assert.equal(f.counts().wraps, 0);
  }
});
test("noncanonical native replies fail closed and caller mutation cannot replace the signed target", async () => {
  for (const body of ["", toBase64(new Uint8Array(132)), "!".repeat(176)]) {
    const f = await fixture();
    f.response(body);
    await assert.rejects(f.controller.prepare(f.input), CommandResultError);
    assert.equal(f.counts().builds, 0);
  }
  const f = await fixture();
  f.native(() => {
    f.input.command.target.node_id = id("0xff");
    f.input.membershipId = id("0xff");
  });
  await f.controller.prepare(f.input);
  assert.equal(f.counts().builds, 1);
});
