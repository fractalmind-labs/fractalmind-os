import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress as id, toBase64 } from "@mysten/sui/utils";
import {
  CoordinatorBindingBcs,
  HostIndexBcs,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  CoordinatorReadClient,
  CoordinatorReadError,
} from "../src/coordinator-read";
import { coordinatorHosts } from "../src/host-observations";
import { OrganizationBcs } from "../src/device-identity";
import { ChainReadSession } from "../src/chain";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";

const org = id("0x1"),
  human = id("0x2"),
  grant = id("0x3"),
  bindingId = id("0x4"),
  pkg = id("0x5");
const failure = (code: string) => (e: unknown) =>
  e instanceof CoordinatorReadError && e.code === code;
async function fixture(mode = "valid") {
  const device = Ed25519Keypair.generate(),
    coordinator = Ed25519Keypair.generate();
  let nativeProofs = 0,
    reads = 0,
    authority = true,
    changed = false;
  const transport: NativeInvoke = async (command, args) => {
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: args.profile,
        address: device.toSuiAddress(),
        signingPublicKey: device.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(new Uint8Array(32).fill(4)),
      };
    assert.equal(command, "fm_device_prove");
    nativeProofs++;
    return device.signPersonalMessage(new TextEncoder().encode(args.challenge));
  };
  const signer = await NativeDeviceSigner.load(transport, "unit-only");
  const table = { id: id("0x10"), size: "0" };
  const binding = {
    id: bindingId,
    org_id: org,
    coordinator_address: coordinator.toSuiAddress(),
    public_key: Array.from(coordinator.getPublicKey().toRawBytes()),
    endpoint: "http://127.0.0.1:19090",
    version: "1",
    revoked: false,
  };
  const orgObject = {
    id: org,
    name: "Test",
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
  const chain = {
    profile: { humanId: human },
    checkNetwork: async () => "Test1",
    human: async () => ({
      human: { organizations: [org] },
      clockMs: BigInt(Date.now()),
      loadedAtMs: Date.now(),
    }),
    sdk: {
      client: {
        typesPackageId: pkg,
        client: {
          core: {
            getObject: async ({ objectId }: { objectId: string }) => ({
              object: {
                objectId,
                version: "1",
                owner: { $kind: "Shared" },
                type:
                  objectId === org
                    ? `${pkg}::organization::Organization`
                    : `${pkg}::host::CoordinatorBinding`,
                content:
                  objectId === org
                    ? OrganizationBcs.serialize(orgObject).toBytes()
                    : CoordinatorBindingBcs.serialize({
                        ...binding,
                        version: changed ? "2" : "1",
                      }).toBytes(),
              },
            }),
            getDynamicField: async () => ({
              dynamicField: {
                value: {
                  type: `${pkg}::host::HostIndex`,
                  bcs: HostIndexBcs.serialize({
                    bindings: [bindingId],
                    invitations: [],
                    memberships: [],
                    active_hosts: table,
                    instances: table,
                  }).toBytes(),
                },
              },
            }),
          },
        },
      },
    },
  } as unknown as ChainReadSession;
  let challenge: Record<string, unknown> = {};
  const sign = async (text: string) =>
    Array.from(await coordinator.sign(new TextEncoder().encode(text)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const body = { sentinels: [], count: 0 };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    if (String(input).endsWith("/api/device-challenge")) {
      assert.equal(init?.method, "POST");
      challenge = {
        ...JSON.parse(String(init?.body)),
        chain_identifier: "Test1",
        nonce: "a".repeat(32),
        expires_at_ms: Date.now() + 60_000,
        coordinator_public_key: Buffer.from(
          coordinator.getPublicKey().toRawBytes(),
        ).toString("hex"),
      };
      const signed = [
        "FM-COORDINATOR-READ",
        "1",
        challenge.chain_identifier,
        challenge.organization_id,
        challenge.binding_id,
        challenge.human_id,
        challenge.grant_id,
        challenge.device_address,
        challenge.method,
        challenge.path,
        challenge.nonce,
        challenge.expires_at_ms,
      ].join(":");
      challenge.signature = await sign(signed);
      if (mode === "challenge-signature") challenge.signature = "0".repeat(128);
      if (mode === "challenge-path") challenge.path = "/api/health";
      if (mode === "challenge-chain") challenge.chain_identifier = "Wrong1";
      if (mode === "challenge-expired")
        challenge.expires_at_ms = Date.now() - 1;
      if (mode === "binding-changed") changed = true;
      return Response.json(challenge);
    }
    assert.equal(init?.method, "GET");
    reads++;
    const header = (init?.headers as Record<string, string>).Authorization;
    assert.ok(header.startsWith("FractalMind "));
    const proof = JSON.parse(
      Buffer.from(header.slice(12), "base64url").toString(),
    );
    assert.equal(proof.nonce, challenge.nonce);
    await device
      .getPublicKey()
      .verifyPersonalMessage(
        new TextEncoder().encode(
          [
            "FM-DEVICE-PROOF",
            "1",
            "Test1",
            human,
            grant,
            challenge.nonce,
            challenge.expires_at_ms,
          ].join(":"),
        ),
        proof.signature,
      )
      .then((valid) => assert.ok(valid));
    if (mode === "server-rejected")
      return Response.json({ error: "device_read_rejected" }, { status: 403 });
    const raw = new TextEncoder().encode(JSON.stringify(body));
    const hash = Buffer.from(
      await crypto.subtle.digest("SHA-256", raw),
    ).toString("hex");
    const text = [
      "FM-COORDINATOR-RESPONSE",
      "1",
      "Test1",
      org,
      bindingId,
      challenge.nonce,
      "GET",
      "/api/sentinels",
      200,
      hash,
    ].join(":");
    const envelope = {
      nonce: challenge.nonce,
      body: toBase64(raw),
      signature: await sign(text),
    };
    if (mode === "body-tampered")
      envelope.body = toBase64(
        new TextEncoder().encode('{"sentinels":[],"count":1}'),
      );
    if (mode === "response-nonce") envelope.nonce = "b".repeat(32);
    if (mode === "response-signature") envelope.signature = "0".repeat(128);
    if (mode === "response-binding") changed = true;
    if (mode === "response-authority") authority = false;
    return Response.json(envelope);
  };
  const client = new CoordinatorReadClient(chain, signer, grant, org, fetcher);
  // DeviceIdentityVerifier is covered by its own chain tests and the real Go/SDK
  // integration. These cases isolate client trust and asynchronous mutations.
  client.verifier.verifyOrganization = async () => {
    if (!authority) throw new Error("revoked");
    return {} as never;
  };
  return { client, counters: () => ({ nativeProofs, reads }) };
}
test("signed read is one-use and discloses no proof before trusting the Coordinator", async () => {
  const f = await fixture();
  const prepared = await f.client.prepare(bindingId);
  assert.deepEqual(await prepared.send(), { sentinels: [], count: 0 });
  await assert.rejects(prepared.send(), failure("read_already_used"));
  assert.deepEqual(f.counters(), { nativeProofs: 1, reads: 1 });
});
test("untrusted challenge, scope, expiry and changed binding fail before native proof", async () => {
  for (const mode of [
    "challenge-signature",
    "challenge-path",
    "challenge-chain",
    "challenge-expired",
    "binding-changed",
  ]) {
    const f = await fixture(mode);
    await assert.rejects(
      f.client.read(bindingId),
      failure(
        mode === "binding-changed" ? "binding_changed" : "invalid_challenge",
      ),
    );
    assert.deepEqual(f.counters(), { nativeProofs: 0, reads: 0 }, mode);
  }
});
test("tampered response and authority changes never return observations", async () => {
  for (const mode of [
    "body-tampered",
    "response-nonce",
    "response-signature",
    "response-binding",
    "response-authority",
    "server-rejected",
  ]) {
    const f = await fixture(mode);
    await assert.rejects(f.client.read(bindingId));
    assert.deepEqual(f.counters(), { nativeProofs: 1, reads: 1 }, mode);
  }
});
test("observation display rejects aliases, duplicate Hosts and invalid resource or time fields", () => {
  const row = {
    id: id("0x20"),
    host_id: id("0x20"),
    hostname: "local-host",
    last_heartbeat: new Date().toISOString(),
    agent_count: 2,
    system: { os: "darwin", arch: "arm64", num_cpu: 8 },
  };
  const envelope = (rows: unknown[]) => ({
    sentinels: rows,
    count: rows.length,
  });
  assert.equal(coordinatorHosts(envelope([row]))[0].system?.cpu, 8);
  assert.equal(
    coordinatorHosts(
      envelope([{ ...row, last_heartbeat: null, system: null }]),
    )[0].heartbeatMs,
    null,
  );
  for (const invalid of [
    { ...row, host_id: "local-host" },
    { ...row, id: id("0x99") },
    { ...row, agent_count: -1 },
    { ...row, last_heartbeat: new Date(Date.now() + 600_000).toISOString() },
    { ...row, system: { ...row.system, num_cpu: 0 } },
    { ...row, hostname: "<name>\n" },
  ])
    assert.throws(
      () => coordinatorHosts(envelope([invalid])),
      failure("invalid_observation"),
    );
  assert.throws(
    () => coordinatorHosts(envelope([row, row])),
    failure("invalid_observation"),
  );
  assert.throws(
    () => coordinatorHosts({ sentinels: [], count: 1 }),
    failure("invalid_observation"),
  );
});
