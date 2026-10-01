import test from "node:test";
import assert from "node:assert/strict";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64, normalizeSuiAddress as id } from "@mysten/sui/utils";
import {
  DeviceGrantBcs,
  HumanIdentityBcs,
  IdentityRegistryBcs,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  DeviceIdentityVerifier,
  DeviceIdentityError,
} from "../src/device-identity";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import type { ChainReadSession } from "../src/chain";

async function fixture() {
  const key = Ed25519Keypair.generate(),
    encryption = new Uint8Array(32).fill(4);
  let proveCalls = 0,
    source: "normal" | "foreignType" | "owned" | "uid" = "normal",
    changeVersion = false;
  const invoke: NativeInvoke = async (command, args) => {
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: "primary",
        address: key.toSuiAddress(),
        signingPublicKey: key.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(encryption),
      };
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
    organizations: [],
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
            getObject: async ({ objectId }: { objectId: string }) => {
              const data =
                objectId === human.id
                  ? [
                      HumanIdentityBcs.serialize({
                        ...human,
                        ...(source === "uid" ? { id: id("0x99") } : {}),
                      }).toBytes(),
                      "HumanIdentity",
                    ]
                  : objectId === grant.id
                    ? [DeviceGrantBcs.serialize(grant).toBytes(), "DeviceGrant"]
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
