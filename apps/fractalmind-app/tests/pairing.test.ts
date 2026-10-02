import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress, toBase64 } from "@mysten/sui/utils";
import { MemoryTransactionJournal } from "@fractalmind-labs/fractalmind-sdk";
import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";
import { DevicePairing, pairingFingerprint } from "../src/pairing";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { ChainReadSession } from "../src/chain";

test("pairing fingerprint binds both independent keys, chain, identity, scope and human-visible request details", async () => {
  const key = Ed25519Keypair.generate();
  const request = {
    id: normalizeSuiAddress("0x1"),
    human_id: normalizeSuiAddress("0x2"),
    organization_id: normalizeSuiAddress("0x3"),
    generation: "1",
    device: key.toSuiAddress(),
    signing_public_key: Array.from(key.getPublicKey().toRawBytes()),
    encryption_public_key: Array(32).fill(4),
    device_name: "Phone",
    platform: "ios",
    expires_at_ms: "10000",
    status: 0,
    grant_id: null,
  };
  const base = await pairingFingerprint("chainA", request);
  assert.equal(base.length, 64);
  assert.equal(
    await pairingFingerprint("chainA", structuredClone(request)),
    base,
  );
  for (const changed of [
    { human_id: normalizeSuiAddress("0x4") },
    { organization_id: normalizeSuiAddress("0x5") },
    { generation: "2" },
    { device_name: "Another" },
    { platform: "android" },
    { expires_at_ms: "10001" },
    { encryption_public_key: Array(32).fill(5) },
  ]) {
    assert.notEqual(
      await pairingFingerprint("chainA", { ...request, ...changed }),
      base,
    );
  }
  assert.notEqual(await pairingFingerprint("chainB", request), base);
});

async function controller() {
  const key = Ed25519Keypair.generate();
  const describe = {
    format: 1,
    profile: "test-pair",
    address: key.toSuiAddress(),
    signingPublicKey: key.getPublicKey().toBase64(),
    encryptionPublicKey: toBase64(new Uint8Array(32).fill(4)),
  };
  const invoke: NativeInvoke = async (command) => {
    assert.equal(
      command,
      "fm_device_public",
      "no native signing/wrapping/initialization may occur",
    );
    return describe;
  };
  const device = await NativeDeviceSigner.load(invoke, describe.profile);
  const chain = {
    profile: { network: "localnet" },
    sdk: { client: { client: { core: {} } } },
    checkNetwork: async () => "chainA",
  } as unknown as ChainReadSession;
  const pair = new DevicePairing(
    chain,
    device,
    new MemoryTransactionJournal(),
    invoke,
  );
  (pair as any).base = async () => {
    throw new Error("Must not read a new source");
  };
  pair.inspect = async () => {
    throw new Error("Must not read a new request");
  };
  return pair;
}
test("original ambiguous pairing outcome precedes source reads, confirmation or new native key distribution", async () => {
  const pair = await controller(),
    original = {
      status: "unknown" as const,
      requestId: "pair-approve:test",
      digest: "original",
      journalSynced: true,
    };
  pair.manager.query = async () => original;
  assert.equal(
    await pair.prepareCreate("unread", "new request", "ios"),
    original,
  );
  assert.equal(
    await pair.prepareApproval("unread", "unread", ["read"], 7, false),
    original,
  );
  assert.equal(
    await pair.prepareDataSharing("unread", "unread", false),
    original,
  );
  assert.equal(await pair.prepareResolution("unread", "cancel"), original);
});
test("unapproved fingerprint/data sharing and a forged quote never reach source reads, signing or broadcast", async () => {
  const pair = await controller();
  pair.manager.query = async () => undefined;
  await assert.rejects(
    pair.prepareApproval("unread", "unread", ["read"], 7, false),
    /confirmation_required/,
  );
  await assert.rejects(
    pair.prepareDataSharing("unread", "unread", false),
    /confirmation_required/,
  );
  await assert.rejects(
    pair.submit({ requestId: "forged" } as any),
    /invalid_quote/,
  );
});

test("confirmed pairing waits for receipt output versions; stale/missing objects are not current and RPC failure propagates", async () => {
  const pair = await controller();
  const objectId = normalizeSuiAddress("0x7");
  const outcome = {
    status: "confirmed",
    transaction: {
      effects: {
        changedObjects: [
          { objectId, outputState: "ObjectWrite", outputVersion: "4" },
        ],
      },
    },
  } as unknown as SelfPayTransactionOutcome;
  const core = pair.chain.sdk.client.client.core;
  core.getObject = async () => ({ object: { objectId, version: "3" } }) as any;
  assert.equal(await pair.awaitVisible(outcome, 1), false);
  core.getObject = async () => {
    throw { reason: "notFound", objectId };
  };
  assert.equal(await pair.awaitVisible(outcome, 1), false);
  core.getObject = async () => ({ object: { objectId, version: "4" } }) as any;
  assert.equal(await pair.awaitVisible(outcome, 1), true);
  core.getObject = async () => ({ object: { objectId, version: "5" } }) as any;
  assert.equal(await pair.awaitVisible(outcome, 1), true);
  core.getObject = async () => {
    throw new Error("RPC offline");
  };
  await assert.rejects(pair.awaitVisible(outcome, 1), /RPC offline/);
  core.getObject = async () => {
    throw { reason: "notFound", objectId: normalizeSuiAddress("0x8") };
  };
  await assert.rejects(pair.awaitVisible(outcome, 1));
});
