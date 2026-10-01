import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  type NativeInvoke,
} from "../src/native-device";

function fixture() {
  const key = Ed25519Keypair.generate(),
    other = Ed25519Keypair.generate();
  const device = {
    format: 1,
    profile: "primary",
    address: key.toSuiAddress(),
    signingPublicKey: key.getPublicKey().toBase64(),
    encryptionPublicKey: toBase64(new Uint8Array(32).fill(4)),
  };
  const calls: string[] = [];
  let broken:
    | "none"
    | "unavailable"
    | "address"
    | "key"
    | "bytes"
    | "signature"
    | "wrong-key" = "none";
  const invoke: NativeInvoke = async (command, args) => {
    calls.push(command);
    if (broken === "unavailable")
      throw new Error("OS internal error containing sensitive data");
    if (command === "fm_device_public" || command === "fm_device_initialize") {
      return {
        ...device,
        ...(broken === "address" ? { address: other.toSuiAddress() } : {}),
        ...(broken === "key" ? { encryptionPublicKey: "bad" } : {}),
      };
    }
    const bytes =
      command === "fm_device_prove"
        ? new TextEncoder().encode(args.challenge)
        : Uint8Array.from(atob(args.bytes), (x) => x.charCodeAt(0));
    const signer = broken === "wrong-key" ? other : key;
    const signed =
      command === "fm_device_prove"
        ? await signer.signPersonalMessage(bytes)
        : await signer.signTransaction(bytes);
    if (broken === "bytes") signed.bytes = toBase64(new Uint8Array([9]));
    if (broken === "signature") {
      const raw = Uint8Array.from(atob(signed.signature), (x) =>
        x.charCodeAt(0),
      );
      raw[1] ^= 1;
      signed.signature = toBase64(raw);
    }
    return signed;
  };
  return {
    invoke,
    device,
    key,
    calls,
    break: (value: typeof broken) => {
      broken = value;
    },
  };
}
const hasCode = (code: NativeDeviceError["code"]) => (error: unknown) =>
  error instanceof NativeDeviceError && error.code === code;
test("native loading validates public keys, addresses and profile without initialization", async () => {
  const f = fixture();
  const signer = await NativeDeviceSigner.load(f.invoke, "primary");
  assert.equal(signer.getPublicKey().toSuiAddress(), f.device.address);
  assert.deepEqual(f.calls, ["fm_device_public"]);
  const publicBytes = signer.getPublicKey().toRawBytes();
  publicBytes.fill(0);
  assert.equal(signer.getPublicKey().toSuiAddress(), f.device.address);
  assert.ok(Object.isFrozen(signer.device));
  await assert.rejects(
    NativeDeviceSigner.load(f.invoke, "../key"),
    hasCode("invalid_profile"),
  );
  f.break("address");
  await assert.rejects(
    NativeDeviceSigner.load(f.invoke, "primary"),
    hasCode("invalid_response"),
  );
  f.break("key");
  await assert.rejects(
    NativeDeviceSigner.load(f.invoke, "primary"),
    hasCode("invalid_response"),
  );
});
test("missing OS identity fails without regenerating keys or revealing OS errors", async () => {
  const f = fixture();
  f.break("unavailable");
  await assert.rejects(
    NativeDeviceSigner.load(f.invoke, "primary"),
    hasCode("native_unavailable"),
  );
  assert.deepEqual(f.calls, ["fm_device_public"]);
});
test("native signatures must cover exactly the submitted bytes and pinned Ed25519 key", async () => {
  const f = fixture(),
    signer = await NativeDeviceSigner.initialize(f.invoke, "primary");
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal((await signer.signTransaction(bytes)).bytes, toBase64(bytes));
  for (const failure of ["bytes", "signature", "wrong-key"] as const) {
    f.break(failure);
    await assert.rejects(
      signer.signTransaction(bytes),
      hasCode("invalid_response"),
    );
  }
  await assert.rejects(
    signer.signTransaction(new Uint8Array()),
    hasCode("invalid_transaction"),
  );
  await assert.rejects(
    signer.signTransaction(new Uint8Array(1024 * 1024 + 1)),
    hasCode("invalid_transaction"),
  );
});
test("async native signing snapshots bytes before caller mutation", async () => {
  const f = fixture(),
    signer = await NativeDeviceSigner.load(f.invoke, "primary");
  const bytes = new Uint8Array([1, 2, 3]),
    pending = signer.signTransaction(bytes);
  bytes.fill(9);
  assert.equal((await pending).bytes, toBase64(new Uint8Array([1, 2, 3])));
});
test("device possession challenges bind chain, Human, grant, nonce and bounded expiry", async () => {
  const f = fixture(),
    signer = await NativeDeviceSigner.load(f.invoke, "primary");
  const input = {
    chainIdentifier: "LocalChain1",
    humanId: normalizeSuiAddress("0x1"),
    grantId: normalizeSuiAddress("0x2"),
    nonce: "3".repeat(32),
    expiresAtMs: 120001,
  };
  const result = await signer.proveDevice(input, 1);
  assert.ok(result.challenge.includes(input.humanId + ":" + input.grantId));
  for (const invalid of [
    { ...input, expiresAtMs: 1 },
    { ...input, expiresAtMs: 120002 },
    { ...input, nonce: "bad" },
    { ...input, chainIdentifier: "chain:inject" },
    { ...input, humanId: "0x1" },
  ]) {
    await assert.rejects(
      signer.proveDevice(invalid, 1),
      hasCode("invalid_proof"),
    );
  }
  f.break("signature");
  await assert.rejects(
    signer.proveDevice(input, 1),
    hasCode("invalid_response"),
  );
});

test("an exact missing-key error is distinct from OS failure and never initializes", async () => {
  const calls: string[] = [];
  const invoke: NativeInvoke = async (command) => {
    calls.push(command);
    throw "NotInitialized";
  };
  await assert.rejects(
    NativeDeviceSigner.load(invoke, "missing-test"),
    hasCode("not_initialized"),
  );
  assert.deepEqual(calls, ["fm_device_public"]);
});
