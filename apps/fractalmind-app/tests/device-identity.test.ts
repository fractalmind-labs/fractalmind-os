import test from "node:test";
import assert from "node:assert/strict";
import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  deriveDynamicFieldID,
  toBase64,
  normalizeSuiAddress as id,
} from "@mysten/sui/utils";
import {
  DeviceGrantBcs,
  HumanIdentityBcs,
  IdentityRegistryBcs,
  MemoryTransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  DeviceIdentityVerifier,
  DeviceIdentityError,
} from "../src/device-identity";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import type { ChainReadSession } from "../src/chain";
import { OkrDraftCreation } from "../src/okr-draft";
import { Transaction } from "@mysten/sui/transactions";
import { PrivateRecords, PrivateRecordError } from "../src/private-records";

async function fixture() {
  const key = Ed25519Keypair.generate(),
    encryption = new Uint8Array(32).fill(4);
  let proveCalls = 0,
    source: "normal" | "foreignType" | "owned" | "uid" = "normal",
    changeVersion = false;
  const orgId = id("0x70");
  const orgTable = { id: id("0x71"), size: "0" };
  const org = {
    id: orgId,
    name: "test",
    description: "",
    admin: id("0x1"),
    is_active: true,
    agents: orgTable,
    agent_count: "0",
    tasks: orgTable,
    task_count: "0",
    parent_org: null,
    child_orgs: orgTable,
    child_org_count: "0",
    depth: "0",
    created_at: "1",
  };
  const role = {
    owner_human: org.admin,
    admin: true,
    active: true,
    version: "1",
  };
  const tableBcs = bcs.struct("Table", { id: bcs.Address, size: bcs.u64() });
  const orgBcs = bcs.struct("Organization", {
    id: bcs.Address,
    name: bcs.string(),
    description: bcs.string(),
    admin: bcs.Address,
    is_active: bcs.bool(),
    agents: tableBcs,
    agent_count: bcs.u64(),
    tasks: tableBcs,
    task_count: bcs.u64(),
    parent_org: bcs.option(bcs.Address),
    child_orgs: tableBcs,
    child_org_count: bcs.u64(),
    depth: bcs.u64(),
    created_at: bcs.u64(),
  });
  const roleBcs = bcs.struct("OrgRole", {
    owner_human: bcs.Address,
    admin: bcs.bool(),
    active: bcs.bool(),
    version: bcs.u64(),
  });
  const encryptInputs: string[] = [];
  let decryptCalls = 0,
    onDecrypt: (() => void) | undefined;

  const invoke: NativeInvoke = async (command, args) => {
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: "primary",
        address: key.toSuiAddress(),
        signingPublicKey: key.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(encryption),
      };
    if (command === "fm_device_encrypt_record") {
      encryptInputs.push(args.record);
      decryptCalls++;
      onDecrypt?.();
      const body = new Uint8Array(32);
      body.set([70, 77, 69, 49]);
      return toBase64(body);
    }
    if (command === "fm_device_decrypt_record") {
      decryptCalls++;
      onDecrypt?.();
      return toBase64(new TextEncoder().encode("private body"));
    }
    assert.equal(command, "fm_device_prove");
    proveCalls++;
    return key.signPersonalMessage(new TextEncoder().encode(args.challenge));
  };
  const signer = await NativeDeviceSigner.load(invoke, "primary");
  const table = { id: id("0x10"), size: "1" };
  const human = {
    id: id("0x1"),
    registry_id: id("0x2"),
    network: "localnet",
    generation: "1",
    recovery_version: "1",
    recovery_record: id("0x3"),
    recovery_address: id("0x4"),
    admin_caps: table,
    roles: table,
    organizations: [orgId],
    grants: [id("0x5")],
  };
  const grant = {
    id: id("0x5"),
    human_id: human.id,
    device: signer.device.address,
    org_scope: null as string | null,
    actions: [1, 3],
    expires_at_ms: "1001",
    revoked: false,
    version: "1",
    generation: "1",
    encryption_public_key: Array.from(encryption),
    encrypted_keys: [1],
  };
  const registry = {
    id: id("0x2"),
    protocol_registry: id("0x6"),
    recoveries: table,
    devices: table,
  };
  const clockId = id("0x6"),
    packageId = id("0xa");
  let clockMs = "1000";
  const chain = {
    profile: {
      humanId: human.id,
      registryId: registry.protocol_registry,
      network: "localnet",
    },
    checkNetwork: async () => "TestChain1",
    sdk: {
      identity: { resolveRegistry: async () => registry.id },
      client: {
        typesPackageId: packageId,
        client: {
          core: {
            getDynamicField: async () => ({
              dynamicField: {
                value: {
                  type: `${packageId}::identity::OrgRole`,
                  bcs: roleBcs.serialize(role).toBytes(),
                },
              },
            }),
            getObject: async ({ objectId }: { objectId: string }) => {
              const data =
                objectId === orgId
                  ? [orgBcs.serialize(org).toBytes(), "Organization"]
                  : objectId === human.id
                    ? [
                        HumanIdentityBcs.serialize({
                          ...human,
                          ...(source === "uid" ? { id: id("0x99") } : {}),
                        }).toBytes(),
                        "HumanIdentity",
                      ]
                    : objectId === grant.id
                      ? [
                          DeviceGrantBcs.serialize(grant).toBytes(),
                          "DeviceGrant",
                        ]
                      : objectId === registry.id
                        ? [
                            IdentityRegistryBcs.serialize(registry).toBytes(),
                            "IdentityRegistry",
                          ]
                        : [
                            bcs
                              .struct("Clock", {
                                id: bcs.Address,
                                timestamp_ms: bcs.u64(),
                              })
                              .serialize({ id: clockId, timestamp_ms: clockMs })
                              .toBytes(),
                            "Clock",
                          ];
              return {
                object: {
                  objectId,
                  type:
                    data[1] === "Clock"
                      ? `${id("0x2")}::clock::Clock`
                      : data[1] === "Organization"
                        ? `${packageId}::organization::Organization`
                        : `${source === "foreignType" ? id("0xb") : packageId}::identity::${data[1]}`,
                  owner: {
                    $kind: source === "owned" ? "AddressOwner" : "Shared",
                  },
                  content: data[0],
                  version: changeVersion && proveCalls ? "2" : "1",
                },
              };
            },
          },
        },
      },
    },
  } as unknown as ChainReadSession;
  return {
    verifier: () => new DeviceIdentityVerifier(chain, signer, grant.id),
    chain,
    signer,
    invoke,
    orgId,
    org,
    role,
    encryptInputs: () => encryptInputs,
    decryptCalls: () => decryptCalls,
    onDecrypt: (fn: () => void) => {
      onDecrypt = fn;
    },
    human,
    grant,
    registry,
    calls: () => proveCalls,
    source: (value: typeof source) => {
      source = value;
    },
    clock: (value: string) => {
      clockMs = value;
    },
    change: () => {
      changeVersion = true;
    },
  };
}
const code = (expected: string) => (error: unknown) =>
  error instanceof DeviceIdentityError && error.code === expected;
test("device login proves native key possession against a current independent grant", async () => {
  const f = await fixture();
  const result = await f.verifier().verify();
  assert.equal(result.humanId, f.human.id);
  assert.equal(result.grantId, f.grant.id);
  assert.deepEqual(result.actions, ["read", "approve"]);
  assert.equal(f.calls(), 1);
});
test("foreign source, owned object and mismatched BCS UID never establish identity", async () => {
  for (const source of ["foreignType", "owned", "uid"] as const) {
    const f = await fixture();
    f.source(source);
    await assert.rejects(f.verifier().verify(), code("invalid_source"));
    assert.equal(f.calls(), 0);
  }
});
test("revocation, recovery generation, wrong device/encryption key and unlisted grant reject possession", async () => {
  for (const mutation of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.grant.revoked = true;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.human.generation = "2";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.grant.device = id("0x9");
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.grant.encryption_public_key.fill(5);
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.human.grants = [];
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.grant.actions = [3];
    },
  ]) {
    const f = await fixture();
    mutation(f);
    await assert.rejects(f.verifier().verify(), code("invalid_grant"));
    assert.equal(f.calls(), 0);
  }
});
test("grant expires at exact chain Clock boundary, and changing state during proof rejects login", async () => {
  const f = await fixture();
  f.clock("1001");
  await assert.rejects(f.verifier().verify(), code("grant_expired"));
  assert.equal(f.calls(), 0);
  const changed = await fixture();
  changed.change();
  await assert.rejects(changed.verifier().verify(), code("state_changed"));
  assert.equal(changed.calls(), 1);
});
test("network or registry mismatch cannot be fixed by a valid native signature", async () => {
  const f = await fixture();
  f.human.network = "testnet";
  await assert.rejects(f.verifier().verify(), code("invalid_source"));
  assert.equal(f.calls(), 0);
});

test("organization reads require active matching roles and grant scope, even with valid possession", async () => {
  for (const mutation of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.role.active = false;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.role.owner_human = id("0x99");
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.org.is_active = false;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.grant.org_scope = id("0x99");
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.human.organizations = [];
    },
  ]) {
    const f = await fixture();
    mutation(f);
    await assert.rejects(
      f.verifier().verifyOrganization(f.orgId),
      code("invalid_grant"),
    );
    assert.equal(f.calls(), 0);
  }
  const f = await fixture();
  const bound = await f.verifier().verifyOrganization(f.orgId);
  assert.equal(bound.organizationId, f.orgId);
  assert.equal(bound.encryptedKeys, toBase64(Uint8Array.of(1)));
});
async function recordFixture() {
  const f = await fixture(),
    pointer = {
      kind: 1,
      logicalId: "private",
      record_id: id("0x88"),
      revision: "1",
      key_version: "1",
    };
  const record = {
    id: pointer.record_id,
    organization_id: f.orgId,
    kind: 1,
    logical_id: "private",
    revision: "1",
    key_version: "1",
    encrypted_body: [70, 77, 69, 49],
    previous: null as string | null,
  };
  let head = { record_id: pointer.record_id, revision: "1", key_version: "1" };
  Object.defineProperty(f.chain.sdk, "productRecord", {
    value: {
      listCurrent: async () => ({
        records: [pointer],
        keyVersion: "1",
        cursor: null,
        hasNextPage: false,
      }),
      getCurrent: async () => head,
      getRecord: async () => record,
    } as unknown as ChainReadSession["sdk"]["productRecord"],
  });
  return {
    ...f,
    pointer,
    record,
    head,
    api: () =>
      new PrivateRecords(f.chain, f.signer, f.grant.id, f.orgId, f.invoke),
  };
}
test("private record reads release only freshly authorized current chain bodies", async () => {
  const f = await recordFixture();
  assert.equal((await f.api().list()).length, 1);
  const body = await f.api().read(f.pointer);
  assert.equal(new TextDecoder().decode(body), "private body");
  body.fill(0);
  assert.equal(f.decryptCalls(), 1);
});
test("foreign record scope and stale directory never reach native decrypt", async () => {
  for (const mutation of [
    (f: Awaited<ReturnType<typeof recordFixture>>) => {
      f.record.organization_id = id("0x99");
    },
    (f: Awaited<ReturnType<typeof recordFixture>>) => {
      f.head.record_id = id("0x99");
    },
    (f: Awaited<ReturnType<typeof recordFixture>>) => {
      f.record.key_version = "2";
    },
  ]) {
    const f = await recordFixture();
    mutation(f);
    await assert.rejects(
      f.api().read(f.pointer),
      (e) => e instanceof PrivateRecordError,
    );
    assert.equal(f.decryptCalls(), 0);
  }
});
test("revocation, permission changes and directory races while decrypting do not release plaintext", async () => {
  for (const mutation of [
    (f: Awaited<ReturnType<typeof recordFixture>>) => {
      f.grant.revoked = true;
    },
    (f: Awaited<ReturnType<typeof recordFixture>>) => {
      f.role.version = "2";
    },
    (f: Awaited<ReturnType<typeof recordFixture>>) => {
      f.head.revision = "2";
    },
  ]) {
    const f = await recordFixture();
    f.onDecrypt(() => mutation(f));
    await assert.rejects(f.api().read(f.pointer));
    assert.equal(f.decryptCalls(), 1);
  }
});

test("only an exact missing organization index is empty; child and network failures remain unknown", async () => {
  const f = await recordFixture();
  const expected = deriveDynamicFieldID(
    f.orgId,
    TypeTagSerializer.parseFromStr(
      `${f.chain.sdk.client.typesPackageId}::product_record::IndexBinding`,
    ),
    Uint8Array.of(0),
  );
  f.chain.sdk.productRecord.listCurrent = async () => {
    throw { reason: "notFound", objectId: expected };
  };
  assert.deepEqual(await f.api().list(), []);
  f.chain.sdk.productRecord.listCurrent = async () => {
    throw { reason: "notFound", objectId: id("0x99") };
  };
  await assert.rejects(f.api().list());
  f.chain.sdk.productRecord.listCurrent = async () => {
    throw new Error("Network unavailable");
  };
  await assert.rejects(f.api().list());
});

async function historyFixture() {
  const f = await recordFixture();
  const second = {
    ...f.record,
    id: id("0x89"),
    revision: "2",
    previous: f.record.id,
  };
  const third = {
    ...f.record,
    id: id("0x90"),
    revision: "3",
    previous: second.id,
  };
  Object.assign(f.head, { record_id: third.id, revision: "3" });
  const rows = new Map([f.record, second, third].map((r) => [r.id, r]));
  const fetched: string[] = [];
  f.chain.sdk.productRecord.getRecord = async (recordId) => {
    fetched.push(recordId);
    const row = rows.get(recordId);
    assert.ok(row);
    return row as Awaited<
      ReturnType<typeof f.chain.sdk.productRecord.getRecord>
    >;
  };
  return { ...f, second, third, rows, fetched };
}
test("historical native reads follow the immutable chain from its current head; default reads still reject old records", async () => {
  const f = await historyFixture();
  await assert.rejects(f.api().read(f.pointer), /directory_changed/);
  assert.equal(f.decryptCalls(), 0);
  const body = await f.api().read(f.pointer, true);
  assert.equal(new TextDecoder().decode(body), "private body");
  body.fill(0);
  assert.deepEqual(f.fetched, [f.third.id, f.second.id, f.record.id]);
  assert.equal(f.decryptCalls(), 1);
});
test("historical reads reject revision gaps, cycles, scope substitutions and a forged requested revision before decrypting", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof historyFixture>>) => {
      f.third.previous = f.record.id;
    },
    (f: Awaited<ReturnType<typeof historyFixture>>) => {
      f.second.previous = f.third.id;
    },
    (f: Awaited<ReturnType<typeof historyFixture>>) => {
      f.second.organization_id = id("0x99");
    },
    (f: Awaited<ReturnType<typeof historyFixture>>) => {
      f.pointer.revision = "2";
    },
  ]) {
    const f = await historyFixture();
    change(f);
    await assert.rejects(f.api().read(f.pointer, true));
    assert.equal(f.decryptCalls(), 0);
  }
});
test("historical decryption rechecks current permission and the current head before releasing plaintext", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof historyFixture>>) => {
      f.grant.revoked = true;
    },
    (f: Awaited<ReturnType<typeof historyFixture>>) => {
      f.head.revision = "4";
    },
  ]) {
    const f = await historyFixture();
    f.onDecrypt(() => change(f));
    await assert.rejects(f.api().read(f.pointer, true));
    assert.equal(f.decryptCalls(), 1);
  }
});

test("approval reads require both an approval action and admin role independently of read access", async () => {
  const f = await fixture();
  f.role.admin = false;
  await f.verifier().verifyOrganization(f.orgId, "read");
  await assert.rejects(
    f.verifier().verifyOrganization(f.orgId, "approve"),
    code("invalid_grant"),
  );
  const g = await fixture();
  g.grant.actions = [1];
  await assert.rejects(
    g.verifier().verifyOrganization(g.orgId, "approve"),
    code("invalid_grant"),
  );
});
async function draftFixture() {
  const f = await recordFixture();
  Object.assign(f.chain.profile, {
    rpcUrl: "http://127.0.0.1:29000",
    network: "localnet",
  });
  let prepareCalls = 0,
    submitCalls = 0;
  Object.defineProperty(f.chain.sdk, "okr", {
    value: {
      listOkrs: async () => ({ okrs: [], hasNextPage: false, cursor: null }),
      createDraft: () => new Transaction(),
    },
  });
  f.chain.sdk.productRecord.listCurrent = async () => ({
    records: [],
    keyVersion: "1",
    cursor: null,
    hasNextPage: false,
  });
  const controller = new OkrDraftCreation(
    f.chain,
    f.signer,
    f.grant.id,
    f.orgId,
    "11111111-1111-4111-8111-111111111111",
    f.invoke,
    new MemoryTransactionJournal(),
  );
  controller.manager.query = async () => undefined;
  const quote = {
    requestId: controller.requestId,
    namespace: "fixture",
    digest: "fixture",
    sender: f.signer.device.address,
    balance: "1",
    requiredBalance: "1",
    gasBudget: "1",
    maxSuiSpend: "0",
    estimatedGas: "1",
    simulatedSuiSpend: "0",
    expiresAtMs: Date.now() + 60000,
  };
  controller.manager.prepare = async () => {
    prepareCalls++;
    return quote;
  };
  controller.manager.submit = async () => {
    submitCalls++;
    return {
      status: "confirmed",
      digest: quote.digest,
      requestId: quote.requestId,
      journalSynced: true,
    };
  };
  const input = {
    objective: "Measured goal",
    successCriteria: "Independent confirmation",
    priority: 1,
    deadlineMs: "2000",
    allowedPaths: ["src"],
    prohibitedActions: ["outside writes"],
    maxCalls: "20",
    krs: [
      {
        title: "Outcome",
        unit: "items",
        precision: 0,
        baseline: "0",
        target: "1",
        weight: "1",
        maxAgeMinutes: "1",
        verificationRule: "Independent evidence",
      },
    ],
  };
  return {
    ...f,
    controller,
    quote,
    input,
    prepareCalls: () => prepareCalls,
    submitCalls: () => submitCalls,
  };
}
test("native encryption prepares a quote without submitting; changed authority blocks explicit submission", async () => {
  const f = await draftFixture();
  const pending = f.controller.prepare(f.input);
  f.input.objective = "caller mutation while awaiting a journal query";
  const quote = await pending;
  const payload = JSON.parse(f.encryptInputs()[0]);
  assert.equal(
    JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(Buffer.from(payload.plaintext, "base64")),
      ),
    ).objective,
    "Measured goal",
  );
  assert.equal("status" in quote, false);
  assert.equal(f.prepareCalls(), 1);
  assert.equal(f.submitCalls(), 0);
  f.role.version = "2";
  await assert.rejects(f.controller.submit(f.quote), /authority_changed/);
  assert.equal(f.submitCalls(), 0);
});
test("known original draft outcomes are returned before encrypting, and encryption-time changes never prepare a transaction", async () => {
  const f = await draftFixture();
  f.controller.manager.query = async () => ({
    status: "unknown",
    digest: "original",
    requestId: f.controller.requestId,
    journalSynced: true,
  });
  const original = await f.controller.prepare(f.input);
  assert.equal("status" in original && original.digest, "original");
  assert.equal(f.decryptCalls(), 0);
  assert.equal(f.prepareCalls(), 0);
  const g = await draftFixture();
  g.onDecrypt(() => {
    g.grant.revoked = true;
  });
  await assert.rejects(g.controller.prepare(g.input));
  assert.equal(g.prepareCalls(), 0);
});
