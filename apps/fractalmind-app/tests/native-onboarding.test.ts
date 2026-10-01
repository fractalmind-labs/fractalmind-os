import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64 } from "@mysten/sui/utils";
import {
  createRecoveryCode,
  recoveryKeys,
  wrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeRecoverySigner } from "../src/native-onboarding";
import type { NativeInvoke } from "../src/native-device";
import { normalizeDeployment } from "../src/onboarding";
async function fixture() {
  const code = createRecoveryCode("localnet"),
    recovery = recoveryKeys(code),
    device = Ed25519Keypair.generate();
  const describe = (key: Ed25519Keypair, enc: Uint8Array) => ({
    format: 1,
    profile: "test-native",
    address: key.toSuiAddress(),
    signingPublicKey: key.getPublicKey().toBase64(),
    encryptionPublicKey: toBase64(enc),
  });
  const envelope = toBase64(
    await wrapKeys(
      new Uint8Array([1]),
      recovery.encryptionPublicKey,
      "fixture",
    ),
  );
  const data = {
    format: 1,
    network: "localnet",
    device: describe(device, new Uint8Array(32).fill(2)),
    recovery: describe(recovery.signer, recovery.encryptionPublicKey),
    encryptedBackup: envelope,
    encryptedDeviceKeys: envelope,
  };
  const calls: string[] = [];
  let failure:
    | "none"
    | "network"
    | "keys"
    | "envelope"
    | "signature"
    | "bytes" = "none";
  const invoke: NativeInvoke = async (command, args) => {
    calls.push(command);
    if (command === "fm_onboarding_create")
      return { public: structuredClone(data), recoveryCode: code };
    if (command === "fm_onboarding_public") {
      const copy = structuredClone(data);
      if (failure === "network") copy.network = "mainnet";
      if (failure === "keys") copy.recovery = copy.device;
      if (failure === "envelope")
        copy.encryptedBackup = toBase64(new Uint8Array(100));
      return copy;
    }
    if (command === "fm_onboarding_sign_transaction") {
      const input = Uint8Array.from(Buffer.from(args.bytes, "base64"));
      if (failure === "bytes") input[0] ^= 1;
      const result = await (
        failure === "signature" ? device : recovery.signer
      ).signTransaction(input);
      return result;
    }
    throw new Error("unexpected command");
  };
  return {
    invoke,
    calls,
    code,
    setFailure: (next: typeof failure) => (failure = next),
  };
}
test("recovery code is only returned on explicit native creation; reload exposes no credential", async () => {
  const f = await fixture(),
    created = await NativeRecoverySigner.create(
      f.invoke,
      "test-native",
      "localnet",
    );
  assert.equal(created.recoveryCode, f.code);
  const restored = await NativeRecoverySigner.load(
    f.invoke,
    "test-native",
    "localnet",
  );
  assert.deepEqual(restored.material, created.signer.material);
  assert.equal("recoveryCode" in restored.material, false);
  assert.deepEqual(f.calls, ["fm_onboarding_create", "fm_onboarding_public"]);
});
test("native recovery bridge rejects foreign network, reused device keys and malformed envelopes", async () => {
  const f = await fixture();
  for (const failure of ["network", "keys", "envelope"] as const) {
    f.setFailure(failure);
    await assert.rejects(
      NativeRecoverySigner.load(f.invoke, "test-native", "localnet"),
      /invalid_response/,
    );
  }
  await assert.rejects(
    NativeRecoverySigner.load(f.invoke, "../path", "localnet"),
    /invalid_profile/,
  );
  assert.equal(f.calls.length, 3);
});
test("native recovery signature must match exact bytes and independent recovery key", async () => {
  const f = await fixture(),
    signer = await NativeRecoverySigner.load(
      f.invoke,
      "test-native",
      "localnet",
    ),
    bytes = new Uint8Array([1, 2, 3]);
  assert.equal((await signer.signTransaction(bytes)).bytes, toBase64(bytes));
  for (const failure of ["signature", "bytes"] as const) {
    f.setFailure(failure);
    await assert.rejects(signer.signTransaction(bytes), /invalid_response/);
  }
});
test("deployment setup needs no existing Human; cache metadata strips secrets and unsafe RPC URLs", () => {
  const id = `0x${"1".repeat(64)}`;
  const input = {
    network: "localnet" as const,
    rpcUrl: "http://127.0.0.1:29000",
    packageId: id,
    registryId: id,
    recoveryCode: "do-not-cache",
    privateKey: "do-not-cache",
  };
  const value = normalizeDeployment(input);
  assert.equal("humanId" in value, false);
  assert.equal("privateKey" in value, false);
  assert.equal("recoveryCode" in value, false);
  assert.throws(() =>
    normalizeDeployment({
      ...input,
      rpcUrl: "https://user:secret@example.com",
    }),
  );
});
