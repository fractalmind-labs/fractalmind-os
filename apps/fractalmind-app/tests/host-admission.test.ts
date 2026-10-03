import { fixtureCoreTypes } from "./helpers/type-origins";
import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  normalizeSuiAddress as id,
  toBase64,
  deriveDynamicFieldID,
} from "@mysten/sui/utils";
import { TypeTagSerializer } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import {
  CoordinatorBindingBcs,
  HostInviteBcs,
  HostIndexBcs,
  MemoryTransactionJournal,
  parseHostInviteCode,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  HostAdmission,
  coordinatorInput,
  hostDirectory,
} from "../src/host-admission";
import { OrganizationBcs } from "../src/device-identity";
import { ChainReadSession } from "../src/chain";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
const orgId = id("0x30"),
  packageId = id("0x31"),
  bindingId = id("0x32"),
  inviteId = id("0x33"),
  grantId = id("0x34"),
  humanId = id("0x35");
const attempt = "00000000-0000-0000-0000-000000000001";
async function fixture() {
  const key = Ed25519Keypair.generate(),
    coordinator = Ed25519Keypair.generate();
  const invoke: NativeInvoke = async (command, args) => {
    assert.equal(
      command,
      "fm_device_public",
      "these tests must not request native private operations",
    );
    return {
      format: 1,
      profile: args.profile,
      address: key.toSuiAddress(),
      signingPublicKey: key.getPublicKey().toBase64(),
      encryptionPublicKey: toBase64(new Uint8Array(32).fill(3)),
    };
  };
  const device = await NativeDeviceSigner.load(invoke, "test-host"),
    table = { id: id("0x40"), size: "0" };
  const org = {
    id: orgId,
    name: "Test",
    description: "",
    admin: humanId,
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
    org_id: orgId,
    coordinator_address: coordinator.toSuiAddress(),
    public_key: Array.from(coordinator.getPublicKey().toRawBytes()),
    endpoint: "http://127.0.0.1:19090",
    version: "1",
    revoked: false,
  };
  const invite = {
    id: inviteId,
    org_id: orgId,
    coordinator_binding: bindingId,
    binding_version: "1",
    issuer_human: humanId,
    issuer_device: device.device.address,
    issuer_grant: grantId,
    issuer_grant_version: "1",
    issuer_generation: "1",
    proof_public_key: Array(32).fill(7),
    template_version: "1",
    expires_at_ms: "3601000",
    membership_ttl_ms: "2592000000",
    capability_ttl_ms: "86400000",
    max_uses: 1,
    uses: 0,
    revoked: false,
  };
  const index = {
    bindings: [bindingId],
    invitations: [inviteId],
    memberships: [] as string[],
    active_hosts: table,
    instances: table,
  };
  let clockMs = 1000n,
    authority = "current",
    indexMode = "normal",
    mode = "normal",
    prepares = 0,
    submissions = 0;
  const core = {
    getObject: async ({ objectId }: { objectId: string }) => {
      const objects = {
        [orgId]: {
          type: `${packageId}::organization::Organization`,
          content: OrganizationBcs.serialize(org).toBytes(),
        },
        [bindingId]: {
          type: `${packageId}::host::CoordinatorBinding`,
          content: CoordinatorBindingBcs.serialize(binding).toBytes(),
        },
        [inviteId]: {
          type: `${packageId}::host::HostInvite`,
          content: HostInviteBcs.serialize(invite).toBytes(),
        },
      };
      assert.ok(objects[objectId], objectId);
      return {
        object: {
          objectId: mode === "uid" ? id("0x999") : objectId,
          version: "1",
          owner: { $kind: mode === "owned" ? "AddressOwner" : "Shared" },
          ...objects[objectId],
          ...(mode === "foreign"
            ? { type: `${id("0x777")}::host::CoordinatorBinding` }
            : {}),
        },
      };
    },
    getDynamicField: async () => {
      if (indexMode === "offline") throw new Error("RPC offline");
      if (indexMode === "missing")
        throw {
          reason: "notFound",
          objectId: deriveDynamicFieldID(
            orgId,
            TypeTagSerializer.parseFromStr(
              `${packageId}::host::HostIndexBinding`,
            ),
            new Uint8Array([0]),
          ),
        };
      return {
        dynamicField: {
          value: {
            type:
              indexMode === "foreign"
                ? `${id("0x777")}::host::HostIndex`
                : `${packageId}::host::HostIndex`,
            bcs: HostIndexBcs.serialize(index).toBytes(),
          },
        },
      };
    },
  };
  const chain = {
    profile: { network: "localnet", humanId },
    checkNetwork: async () => "Test1",
    human: async () => ({
      human: { organizations: [orgId] },
      clockMs,
      loadedAtMs: Date.now(),
    }),
    sdk: {
      client: {
        ...fixtureCoreTypes(packageId),
        typesPackageId: packageId,
        client: { core },
      },
      host: {
        createInvite: (params: {
          proofPublicKey: Uint8Array;
          expiresAtMs: string;
        }) => {
          invite.proof_public_key = Array.from(params.proofPublicKey);
          invite.expires_at_ms = params.expiresAtMs;
          return new Transaction();
        },
        createCoordinatorBinding: () => new Transaction(),
        revokeInvite: () => new Transaction(),
        revokeMembership: () => new Transaction(),
      },
    },
  } as unknown as ChainReadSession;
  const controller = new HostAdmission(
    chain,
    device,
    grantId,
    orgId,
    new MemoryTransactionJournal(),
  );
  // Authority proof is covered by DeviceIdentityVerifier tests and the real-chain
  // integration. Here these controlled changes test the controller's quote pins.
  (controller as any).verifier.verifyOrganization = async () => ({
    authorityPin: authority,
    clockMs,
  });
  controller.manager.query = async () => undefined;
  controller.manager.prepare = async ({ requestId }) => {
    prepares++;
    return Object.freeze({ requestId, expiresAtMs: Date.now() + 60000 }) as any;
  };
  controller.manager.submit = async () => {
    submissions++;
    return {
      status: "unknown",
      requestId: `host:${attempt}`,
      digest: "original",
      journalSynced: true,
    };
  };
  const operation = {
    kind: "invite" as const,
    bindingId,
    ttlMinutes: 60 as const,
    membershipDays: 30,
    observationHours: 24,
  };
  const outcome = {
    status: "confirmed",
    requestId: `host:${attempt}`,
    transaction: {
      effects: {
        changedObjects: [
          {
            objectId: inviteId,
            idOperation: "Created",
            outputState: "ObjectWrite",
            outputVersion: "1",
          },
        ],
      },
    },
  } as unknown as SelfPayTransactionOutcome;
  return {
    controller,
    chain,
    binding,
    invite,
    operation,
    outcome,
    setMode: (v: string) => {
      mode = v;
    },
    setIndexMode: (v: string) => {
      indexMode = v;
    },
    setAuthority: (v: string) => {
      authority = v;
    },
    setClock: (v: bigint) => {
      clockMs = v;
    },
    counts: () => ({ prepares, submissions }),
  };
}
test("Coordinator accepts a public key and safe origin; credentials, paths and insecure remote endpoints are rejected", () => {
  const pub = Ed25519Keypair.generate().getPublicKey(),
    key = Buffer.from(pub.toRawBytes()).toString("hex");
  assert.equal(
    coordinatorInput("https://coordinator.example/", key).address,
    pub.toSuiAddress(),
  );
  assert.equal(
    coordinatorInput("http://localhost:19090", key).endpoint,
    "http://localhost:19090",
  );
  for (const endpoint of [
    "http://remote.example",
    "https://u:p@example.com",
    "https://example.com/path",
    "https://example.com/?x=1",
    "https://example.com/#fragment",
    "file:///tmp/coordinator",
  ])
    assert.throws(() => coordinatorInput(endpoint, key), /invalid_input/);
  assert.throws(
    () => coordinatorInput("https://example.com", key.slice(1)),
    /invalid_input/,
  );
});
test("Host reconstruction rejects foreign types/ownership/UID/index provenance; only exact missing index means empty", async () => {
  const f = await fixture();
  assert.equal(
    (await hostDirectory(f.chain, orgId)).invitations[0].id,
    inviteId,
  );
  for (const mode of ["foreign", "owned", "uid"]) {
    f.setMode(mode);
    await assert.rejects(hostDirectory(f.chain, orgId), /invalid_source/);
  }
  f.setMode("normal");
  f.setIndexMode("foreign");
  await assert.rejects(hostDirectory(f.chain, orgId), /invalid_source/);
  f.setIndexMode("offline");
  await assert.rejects(hostDirectory(f.chain, orgId), /RPC offline/);
  f.setIndexMode("missing");
  assert.deepEqual((await hostDirectory(f.chain, orgId)).invitations, []);
});
test("Ambiguous original transaction is queried before a new source, confirmation or invitation secret", async () => {
  const f = await fixture(),
    original = {
      status: "unknown" as const,
      requestId: `host:${attempt}`,
      digest: "original",
      journalSynced: true,
    };
  f.controller.manager.query = async () => original;
  f.setMode("foreign");
  assert.equal(
    await f.controller.prepare(f.operation, attempt, false),
    original,
  );
  assert.equal((f.controller as any).secrets.size, 0);
  assert.deepEqual(f.counts(), { prepares: 0, submissions: 0 });
});
test("No confirmation, malformed durations and forged quotes never prepare or broadcast", async () => {
  const f = await fixture();
  await assert.rejects(
    f.controller.prepare(f.operation, attempt, false),
    /confirmation_required/,
  );
  for (const changed of [
    { ttlMinutes: 1441 },
    { membershipDays: 91 },
    { membershipDays: 0 },
    { observationHours: 721 },
    { observationHours: 1.5 },
  ])
    await assert.rejects(
      f.controller.prepare(
        { ...f.operation, ...changed } as any,
        attempt,
        true,
      ),
      /invalid_input/,
    );
  await assert.rejects(
    f.controller.submit({ requestId: `host:${attempt}` } as any),
    /invalid_quote/,
  );
  assert.deepEqual(f.counts(), { prepares: 0, submissions: 0 });
});
test("Revoked binding, consumed invitation and authority/version/expiry changes block writes", async () => {
  const f = await fixture();
  f.binding.revoked = true;
  await assert.rejects(
    f.controller.prepare(f.operation, attempt, true),
    /unavailable/,
  );
  f.binding.revoked = false;
  f.invite.uses = 1;
  await assert.rejects(
    f.controller.prepare(
      { kind: "revoke-invite", targetId: inviteId },
      attempt,
      true,
    ),
    /unavailable/,
  );
  f.invite.uses = 0;
  const quote = await f.controller.prepare(f.operation, attempt, true);
  assert.ok(!("status" in quote));
  f.setAuthority("revoked");
  await assert.rejects(f.controller.submit(quote), /state_changed/);
  f.setAuthority("current");
  f.binding.version = "2";
  await assert.rejects(f.controller.submit(quote), /state_changed/);
  f.binding.version = "1";
  f.setClock(BigInt(f.invite.expires_at_ms));
  await assert.rejects(f.controller.submit(quote), /state_changed/);
  assert.equal(f.counts().submissions, 0);
});
test("Invitation code is returned only for its exact receipt/key; cancellation/disposal zeroize entropy and reload cannot reconstruct it", async () => {
  const f = await fixture(),
    quote = await f.controller.prepare(f.operation, attempt, true);
  assert.ok(!("status" in quote));
  const material = (f.controller as any).secrets.get(`host:${attempt}`);
  const result = await f.controller.createdInvite(f.outcome);
  assert.ok(result.code);
  assert.equal(parseHostInviteCode(result.code, "localnet").inviteId, inviteId);
  f.invite.uses = 1;
  assert.equal((await f.controller.createdInvite(f.outcome)).code, null);
  f.invite.uses = 0;
  f.invite.proof_public_key[0] ^= 1;
  await assert.rejects(f.controller.createdInvite(f.outcome), /invalid_source/);
  f.invite.proof_public_key[0] ^= 1;
  f.controller.cancel(quote);
  assert.ok(material.entropy.every((n: number) => n === 0));
  assert.equal((await f.controller.createdInvite(f.outcome)).code, null);
  await f.controller.prepare(f.operation, attempt, true);
  const another = (f.controller as any).secrets.get(`host:${attempt}`);
  f.controller.dispose();
  assert.ok(another.entropy.every((n: number) => n === 0));
  assert.equal((await f.controller.createdInvite(f.outcome)).code, null);
});

test("Replacing an unsubmitted quote zeroizes its invitation secret and prevents submission of the previous quote", async () => {
  const f = await fixture();
  const first = await f.controller.prepare(f.operation, attempt, true);
  assert.ok(!("status" in first));
  const oldMaterial = (f.controller as any).secrets.get(`host:${attempt}`);
  const replacement = await f.controller.prepare(f.operation, attempt, true);
  assert.ok(!("status" in replacement));
  assert.ok(oldMaterial.entropy.every((n: number) => n === 0));
  await assert.rejects(f.controller.submit(first), /invalid_quote/);
  assert.equal(f.counts().submissions, 0);
  f.controller.dispose();
});
