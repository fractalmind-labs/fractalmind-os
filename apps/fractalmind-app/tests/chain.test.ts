import test from "node:test";
import assert from "node:assert/strict";
import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import {
  deriveDynamicFieldID,
  normalizeSuiAddress as id,
} from "@mysten/sui/utils";
import type { FractalMindSDK } from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, normalizeProfile, missingIndex } from "../src/chain";
import type { ConnectionProfile } from "../src/domain";

const profile: ConnectionProfile = {
  network: "localnet",
  rpcUrl: "http://127.0.0.1:29000",
  packageId: id("0xa"),
  registryId: id("0xb"),
  humanId: id("0xc"),
};
function fixture() {
  const organizationId = id("0xd");
  const org = {
    objectId: organizationId,
    type: `${profile.packageId}::organization::Organization`,
    name: "A",
    isActive: true,
  };
  const human = {
    id: profile.humanId,
    registry_id: id("0xe"),
    network: "localnet",
    organizations: [organizationId],
    grants: [id("0xf")],
  };
  let chain = "one-chain",
    unavailable = false,
    grantsFailed = false,
    cycle = false;
  const absent = (type: string) => {
    throw Object.assign(new Error("fixture"), {
      code: unavailable ? "UNAVAILABLE" : "notExists",
      reason: unavailable ? "unknown" : "notFound",
      objectId: deriveDynamicFieldID(
        organizationId,
        TypeTagSerializer.parseFromStr(`${profile.packageId}::${type}`),
        new Uint8Array([0]),
      ),
    });
  };
  const sdk = {
    client: {
      typesPackageId: profile.packageId,
      client: {
        core: {
          getChainIdentifier: async () => ({ chainIdentifier: chain }),
          getObject: async () => ({
            object: {
              objectId: id("0x6"),
              type: `${id("0x2")}::clock::Clock`,
              owner: { $kind: "Shared" },
              content: bcs
                .struct("Clock", { id: bcs.Address, timestamp_ms: bcs.u64() })
                .serialize({ id: id("0x6"), timestamp_ms: 1000 })
                .toBytes(),
            },
          }),
        },
      },
    },
    identity: {
      resolveRegistry: async () => id("0xe"),
      getHuman: async () => human,
      getDeviceGrant: async () => {
        if (grantsFailed) throw new Error("fixture");
        return { id: id("0xf"), human_id: profile.humanId };
      },
    },
    organization: { getOrganization: async () => org },
    okr: {
      isMissingIndex: (error: unknown, org: string) =>
        missingIndex(error, org, `${profile.packageId}::okr::IndexKey`),
      listOkrs: async () => {
        if (cycle)
          return { okrs: [], hasNextPage: true, cursor: "repeated-cursor" };
        return absent("okr::IndexKey");
      },
      getIndex: async () => absent("okr::IndexKey"),
    },
    host: { getIndex: async () => absent("host::HostIndexBinding") },
  } as unknown as FractalMindSDK;
  return {
    sdk,
    org,
    human,
    organizationId,
    session: () => new ChainReadSession(profile, sdk),
    changeChain: () => {
      chain = "another-chain";
    },
    failNetwork: () => {
      unavailable = true;
    },
    failGrants: () => {
      grantsFailed = true;
    },
    cycle: () => {
      cycle = true;
    },
  };
}

test("connection profiles reject credential URLs, remote plaintext and invalid IDs; strip unrelated secrets", () => {
  const normalized = normalizeProfile({
    ...profile,
    arbitrarySecret: "must-not-persist",
  } as ConnectionProfile);
  assert.equal("arbitrarySecret" in normalized, false);
  for (const rpcUrl of [
    "http://cloud-host.example",
    "https://user:password@host.example",
    "file:///tmp/state",
    "https://host.example/?token=x",
  ])
    assert.throws(() => normalizeProfile({ ...profile, rpcUrl }));
  assert.throws(() =>
    normalizeProfile({ ...profile, humanId: "not-an-object" }),
  );
  assert.throws(() =>
    normalizeProfile({
      ...profile,
      network: "unknown" as ConnectionProfile["network"],
    }),
  );
});

test("public Human reads must match the configured identity registry and network", async () => {
  const f = fixture();
  assert.equal((await f.session().human()).human.id, profile.humanId);
  f.human.registry_id = id("0x12");
  await assert.rejects(f.session().human(), /invalid_provenance/);
  f.human.registry_id = id("0xe");
  f.human.network = "mainnet";
  await assert.rejects(f.session().human(), /invalid_provenance/);
});

test("a session pins its real chain, including after reopening with a saved public chain ID", async () => {
  const f = fixture(),
    session = f.session();
  assert.equal(await session.checkNetwork(), "one-chain");
  f.changeChain();
  await assert.rejects(session.checkNetwork(), /network_changed/);
  await assert.rejects(
    new ChainReadSession(
      { ...profile, chainIdentifier: "one-chain" },
      f.sdk,
    ).checkNetwork(),
    /network_changed/,
  );
});

test("missing organization directories are empty; RPC failures are unknown, never empty", async () => {
  const f = fixture();
  const empty = await f.session().loadOrganization(f.organizationId);
  assert.deepEqual(empty.okrs.value, []);
  assert.deepEqual(empty.memberships.value, []);
  assert.deepEqual(empty.agents.value, []);
  f.failNetwork();
  const failed = await f.session().loadOrganization(f.organizationId);
  assert.equal(failed.okrs.value, null);
  assert.equal(failed.memberships.value, null);
  assert.equal(failed.bindings.value, null);
});

test("partial grant reads remain unknown and foreign organization objects are rejected", async () => {
  const f = fixture();
  f.failGrants();
  const root = await f.session().human();
  assert.equal(root.grants.value, null);
  assert.equal(root.organizations.length, 1);
  f.org.type = `${id("0x99")}::organization::Organization`;
  await assert.rejects(f.session().human(), /invalid_provenance/);
});

test("a repeated page cursor is a read failure, not a shortened empty directory", async () => {
  const f = fixture();
  f.cycle();
  const snapshot = await f.session().loadOrganization(f.organizationId);
  assert.equal(snapshot.okrs.value, null);
  assert.equal(snapshot.okrs.failure, "invalid_pagination");
});

test("a rejoined Host uses its authoritative pointer even when an old membership has a higher version", async () => {
  const f = fixture();
  const hostAddress = id("0x21"),
    previousId = id("0x22"),
    currentId = id("0x23"),
    tableId = id("0x24");
  const previous = {
    id: previousId,
    org_id: f.organizationId,
    host_address: hostAddress,
    version: "9",
    revoked: true,
  };
  const current = { ...previous, id: currentId, version: "1", revoked: false };
  Object.assign(f.sdk.host, {
    getIndex: async () => ({
      memberships: [previousId, currentId],
      bindings: [],
      active_hosts: { id: tableId },
    }),
    getMembership: async (recordId: string) =>
      recordId === currentId ? current : previous,
    listManagedAgents: async () => ({
      agents: [],
      cursor: null,
      hasNextPage: false,
    }),
  });
  Object.assign(f.sdk.client.client.core, {
    getDynamicField: async (input: {
      parentId: string;
      name: { type: string; bcs: Uint8Array };
    }) => {
      assert.equal(input.parentId, tableId);
      assert.equal(input.name.type, "address");
      assert.equal(bcs.Address.parse(input.name.bcs), hostAddress);
      return {
        dynamicField: {
          value: {
            type: `${id("0x2")}::object::ID`,
            bcs: bcs.Address.serialize(currentId).toBytes(),
          },
        },
      };
    },
  });
  const snapshot = await f.session().loadOrganization(f.organizationId);
  assert.equal(snapshot.hosts.value!.length, 1);
  assert.equal(snapshot.hosts.value![0].current.value!.id, currentId);
  assert.equal(snapshot.hosts.value![0].history.length, 2);
  Object.assign(f.sdk.client.client.core, {
    getDynamicField: async () => {
      throw {
        reason: "notFound",
        objectId: deriveDynamicFieldID(
          tableId,
          TypeTagSerializer.parseFromStr("address"),
          bcs.Address.serialize(hostAddress).toBytes(),
        ),
      };
    },
  });
  const noCurrent = await f.session().loadOrganization(f.organizationId);
  assert.equal(noCurrent.hosts.value![0].current.value, null);
  assert.equal(noCurrent.hosts.value![0].current.failure, undefined);
  assert.equal(noCurrent.hosts.value![0].history.length, 2);
  Object.assign(f.sdk.client.client.core, {
    getDynamicField: async () => {
      throw new Error("RPC unavailable");
    },
  });
  const unavailable = await f.session().loadOrganization(f.organizationId);
  assert.equal(unavailable.hosts.value![0].current.value, null);
  assert.ok(unavailable.hosts.value![0].current.failure);
  assert.equal(unavailable.hosts.value![0].history.length, 2);
});

test("a missing child object cannot be mistaken for an absent organization directory", async () => {
  const f = fixture();
  Object.assign(f.sdk.okr, {
    listOkrs: async () => {
      throw Object.assign(new Error("fixture"), {
        reason: "notFound",
        objectId: id("0x99"),
      });
    },
  });
  const snapshot = await f.session().loadOrganization(f.organizationId);
  assert.equal(snapshot.okrs.value, null);
});
