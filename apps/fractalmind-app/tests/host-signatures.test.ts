import { fixtureCoreTypes } from "./helpers/type-origins";
import test from "node:test";
import assert from "node:assert/strict";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress as id, toBase64 } from "@mysten/sui/utils";
import {
  HostMembershipBcs,
  CoordinatorBindingBcs,
  HostIndexBcs,
} from "@fractalmind-labs/fractalmind-sdk";
import { OrganizationBcs } from "../src/device-identity";
import { ChainReadSession } from "../src/chain";
import {
  verifyHostObservations,
  HostObservationError,
} from "../src/host-signatures";

const org = id("0x71"),
  pkg = id("0x72"),
  bindingId = id("0x73"),
  human = id("0x74"),
  activeTable = id("0x75");
async function fixture(mode = "valid") {
  const keys = [Ed25519Keypair.generate(), Ed25519Keypair.generate()],
    coordinator = Ed25519Keypair.generate();
  const now = Date.now() + (mode === "phone-clock-offset" ? 3600_000 : 0);
  const table = { id: id("0x76"), size: "0" };
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
  const members = keys.map((key, index) => ({
    id: id(`0x${80 + index}`),
    org_id: org,
    host_address: key.toSuiAddress(),
    host_public_key: Array.from(key.getPublicKey().toRawBytes()),
    encryption_public_key: Array(32).fill(1),
    name: `Host ${index}`,
    coordinator_binding: bindingId,
    version: "1",
    revoked: false,
    expires_at_ms: String(now + 86400000),
    joined_at_ms: String(now),
    source_invite: id("0x90"),
    observation_capability: id("0x91"),
  }));
  const index = {
    bindings: [bindingId],
    invitations: [],
    memberships: members.map((m) => m.id),
    active_hosts: { id: activeTable, size: "2" },
    instances: table,
  };
  const sources: Record<string, any>[] = [];
  for (let n = 0; n < keys.length; n++) {
    const body = {
      host_id: keys[n].toSuiAddress(),
      hostname: `actual-${n}`,
      timestamp: new Date(now).toISOString(),
      agents: [],
      discovery: {
        format: 1,
        state: mode === "scan-failed" ? "unavailable" : "complete",
        observed_at: new Date(
          mode === "scan-old" ? now - 60001 : now,
        ).toISOString(),
        instances: [],
      },
      system: { os: "darwin", arch: "arm64", num_cpu: 8 + n },
      uptime_seconds: 10,
    };
    const raw = new TextEncoder().encode(JSON.stringify(body));
    const hash = Buffer.from(
      await crypto.subtle.digest("SHA-256", raw),
    ).toString("hex");
    const s = {
      format: 1,
      chain_identifier: "TestChain",
      organization_id: org,
      membership_id: members[n].id,
      membership_version: "1",
      binding_id: bindingId,
      binding_version: "1",
      host_address: keys[n].toSuiAddress(),
      session_nonce: "a".repeat(64),
      sequence: 1,
      observed_at_ms: now,
      expires_at_ms: now + 60_000,
      body: toBase64(raw),
      signature: "",
    };
    const text = [
      "FM-HOST-OBSERVATION",
      "1",
      s.chain_identifier,
      s.organization_id,
      s.membership_id,
      s.membership_version,
      s.binding_id,
      s.binding_version,
      s.host_address,
      s.session_nonce,
      s.sequence,
      s.observed_at_ms,
      s.expires_at_ms,
      hash,
    ].join(":");
    s.signature = Buffer.from(
      await keys[n].sign(new TextEncoder().encode(text)),
    ).toString("hex");
    sources.push({
      id: keys[n].toSuiAddress(),
      host_id: keys[n].toSuiAddress(),
      hostname: body.hostname,
      last_heartbeat: body.timestamp,
      agent_count: 0,
      system: body.system,
      host_observation: s,
    });
  }
  let activeReads = 0,
    indexReads = 0,
    memberReads = 0;
  const core = {
    getObject: async ({ objectId }: { objectId: string }) => {
      let type: string, content: Uint8Array;
      if (objectId === org) {
        type = `${pkg}::organization::Organization`;
        content = OrganizationBcs.serialize(organization).toBytes();
      } else if (objectId === bindingId) {
        type = `${pkg}::host::CoordinatorBinding`;
        content = CoordinatorBindingBcs.serialize(binding).toBytes();
      } else {
        const member = members.find((m) => m.id === objectId)!;
        assert.ok(member, objectId);
        if (
          objectId === members[0].id &&
          ++memberReads > 1 &&
          mode === "source-changed"
        )
          member.revoked = true;
        type = `${pkg}::host::HostMembership`;
        content = HostMembershipBcs.serialize(member).toBytes();
      }
      return {
        object: {
          objectId,
          version: "1",
          owner: { $kind: "Shared" },
          type,
          content,
        },
      };
    },
    getDynamicField: async ({
      parentId,
      name,
    }: {
      parentId: string;
      name: { bcs: Uint8Array };
    }) => {
      if (parentId === org) {
        indexReads++;
        const current =
          mode === "table-changed" && indexReads > 2
            ? { ...index, active_hosts: { id: id("0xff"), size: "2" } }
            : index;
        return {
          dynamicField: {
            value: {
              type: `${pkg}::host::HostIndex`,
              bcs: HostIndexBcs.serialize(current).toBytes(),
            },
          },
        };
      }
      assert.equal(parentId, activeTable);
      const address = bcs.Address.parse(name.bcs),
        member = members.find((m) => m.host_address === address)!;
      activeReads++;
      if (mode === "RPC-unavailable" && member === members[0])
        throw new Error("RPC unavailable");
      const pointer =
        mode === "pointer-replaced" && member === members[0]
          ? id("0xab")
          : member.id;
      return {
        dynamicField: {
          value: {
            type: `${id("0x2")}::object::ID`,
            bcs: bcs.Address.serialize(pointer).toBytes(),
          },
        },
      };
    },
  };
  const chain = {
    profile: { humanId: human },
    checkNetwork: async () => "TestChain",
    human: async () => ({
      human: { organizations: [org] },
      clockMs: BigInt(mode === "expired" ? now + 60001 : now),
      loadedAtMs: Date.now(),
    }),
    sdk: {
      client: {
        ...fixtureCoreTypes(pkg),
        typesPackageId: pkg,
        client: { core },
      },
    },
  } as unknown as ChainReadSession;
  const s = sources[0].host_observation;
  if (mode === "body-tampered")
    s.body = toBase64(new TextEncoder().encode('{"forged":true}'));
  if (mode === "signature-tampered") s.signature = "0".repeat(128);
  if (mode === "wrong-chain") s.chain_identifier = "WrongChain";
  if (mode === "wrong-org") s.organization_id = id("0xac");
  if (mode === "wrong-member") s.membership_id = members[1].id;
  if (mode === "wrong-version") s.membership_version = "2";
  if (mode === "missing-signature") delete sources[0].host_observation;
  if (mode === "member-revoked") members[0].revoked = true;
  if (mode === "summary-tampered")
    sources[0].system = { os: "forged", arch: "forged", num_cpu: 1000 };
  return {
    chain,
    response: { sentinels: sources, count: sources.length },
    members,
    counters: () => ({ activeReads, indexReads }),
  };
}

test("Host signatures prove source bytes and current pointer; Coordinator summary is not Host evidence", async () => {
  for (const mode of ["valid", "summary-tampered", "phone-clock-offset"]) {
    const f = await fixture(mode);
    const rows = await verifyHostObservations(
      f.chain,
      org,
      bindingId,
      f.response,
    );
    assert.deepEqual(
      rows.map((r) => r.state),
      ["verified", "verified"],
      mode,
    );
    assert.equal(rows[0].observation?.system?.cpu, 8, mode);
    assert.equal(rows[0].observation?.system?.os, "darwin", mode);
    assert.equal(rows[0].membershipId, f.members[0].id);
    assert.ok(
      rows[0].freshUntilMs! > Date.now() &&
        rows[0].freshUntilMs! <= Date.now() + 60_000,
      mode,
    );
  }
});
test("invalid Host row remains unknown without hiding another verified Host", async () => {
  for (const mode of [
    "body-tampered",
    "signature-tampered",
    "wrong-chain",
    "wrong-org",
    "wrong-member",
    "wrong-version",
    "missing-signature",
    "member-revoked",
    "pointer-replaced",
    "RPC-unavailable",
    "source-changed",
  ]) {
    const f = await fixture(mode);
    const rows = await verifyHostObservations(
      f.chain,
      org,
      bindingId,
      f.response,
    );
    assert.equal(rows[0].state, "unknown", mode);
    assert.equal(rows[0].observation, null, mode);
    assert.equal(rows[1].state, "verified", mode);
  }
});
test("expired signed bytes and directory replacement cannot retain current trust", async () => {
  const f = await fixture("expired");
  const rows = await verifyHostObservations(
    f.chain,
    org,
    bindingId,
    f.response,
  );
  assert.deepEqual(
    rows.map((r) => r.state),
    ["expired", "expired"],
  );
  assert.ok(
    rows.every((r) => r.observation === null && r.freshUntilMs === null),
  );
  const changed = await fixture("table-changed");
  await assert.rejects(
    verifyHostObservations(changed.chain, org, bindingId, changed.response),
    (e) => e instanceof HostObservationError && e.code === "invalid_host_scope",
  );
});
test("scan freshness and failure remain independent of a current signed heartbeat", async () => {
  for (const mode of ["valid", "scan-old", "scan-failed"]) {
    const f = await fixture(mode);
    const rows = await verifyHostObservations(
      f.chain,
      org,
      bindingId,
      f.response,
    );
    assert.equal(rows[0].state, "verified");
    assert.equal(
      rows[0].discovery?.state,
      mode === "scan-old"
        ? "expired"
        : mode === "scan-failed"
          ? "unavailable"
          : "complete",
    );
    assert.deepEqual(rows[0].discovery?.instances, []);
    if (mode === "scan-old")
      assert.equal(rows[0].discovery?.freshUntilMs, null);
  }
});
