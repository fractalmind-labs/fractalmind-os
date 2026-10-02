import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { readFile } from "node:fs/promises";
import {
  signNodeCommand,
  nodeCommandSigningBytes,
  verifySignedNodeCommand,
  type SignNodeCommandInput,
} from "@fractalmind-labs/fractalmind-sdk";
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
        : command === "fm_device_sign_node_command"
          ? {
              bytes: toBase64(bytes),
              signature: toBase64(await signer.sign(bytes)),
            }
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

function commandInput(): SignNodeCommandInput {
  return {
    target: {
      organizationId: normalizeSuiAddress("0x1"),
      nodeId: normalizeSuiAddress("0x2"),
      agentId: "native-fixture",
    },
    action: "assign",
    scope: "control",
    capability: { id: normalizeSuiAddress("0x3"), revocationVersion: 1n },
    payload: { task: "完成 KR 并报告证据" },
    budget: { asset: "TOOL_CALLS", amount: 6n },
    commandId: "native-fixture",
    nonce: "native-nonce",
    idempotencyKey: "native-fixture",
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };
}
test("SDK builds envd commands with native device signing and preserves payload integrity", async () => {
  const f = fixture(),
    signer = await NativeDeviceSigner.load(f.invoke, "primary");
  const command = await signNodeCommand(signer, commandInput());
  await verifySignedNodeCommand(command);
  assert.equal(command.signer, f.device.address);
  assert.equal(command.budget?.amount, "6");
  assert.deepEqual(f.calls, [
    "fm_device_public",
    "fm_device_sign_node_command",
  ]);
  await assert.rejects(
    verifySignedNodeCommand({ ...command, payload: { task: "修改任务" } }),
    /payload/,
  );
  await assert.rejects(
    verifySignedNodeCommand({
      ...command,
      target: { ...command.target, node_id: normalizeSuiAddress("0x4") },
    }),
    /signature/,
  );
  for (const failure of ["bytes", "signature", "wrong-key"] as const) {
    f.break(failure);
    await assert.rejects(
      signNodeCommand(signer, commandInput()),
      hasCode("invalid_response"),
    );
  }
});
test("Rust shared public vector produces the identical SDK wire command without wallet intent wrapping", async () => {
  const vector = JSON.parse(
    await readFile(
      new URL("../native/testdata/node-command-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const calls: string[] = [];
  const invoke: NativeInvoke = async (command, args) => {
    calls.push(command);
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: "primary",
        address: vector.deviceAddress,
        signingPublicKey: vector.publicKey,
        encryptionPublicKey: toBase64(new Uint8Array(32).fill(4)),
      };
    assert.equal(command, "fm_device_sign_node_command");
    assert.equal(args.bytes, vector.bytes);
    return { bytes: vector.bytes, signature: vector.signature };
  };
  const signer = await NativeDeviceSigner.load(invoke, "primary");
  const command = await signNodeCommand(signer, {
    ...commandInput(),
    target: {
      organizationId: vector.command.target.organization_id,
      nodeId: vector.command.target.node_id,
      agentId: vector.command.target.agent_id,
    },
    capability: { id: vector.command.capability.id, revocationVersion: 1n },
    action: "status",
    scope: "observation",
    payload: {},
    budget: undefined,
    issuedAtMs: 1700000000000,
    expiresAtMs: 1700000120000,
  });
  assert.deepEqual(command, vector.command);
  await verifySignedNodeCommand(command);
  assert.deepEqual(calls, ["fm_device_public", "fm_device_sign_node_command"]);
});
test("raw signing rejects arbitrary domains, foreign senders and invalid bytes before native invocation", async () => {
  const f = fixture(),
    signer = await NativeDeviceSigner.load(f.invoke, "primary");
  const signed = await signNodeCommand(f.key, commandInput());
  const raw = JSON.parse(
    new TextDecoder().decode(nodeCommandSigningBytes(signed)),
  );
  const encode = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array(8193),
    new Uint8Array([255]),
    encode(null),
    encode({ ...raw, domain: "wallet-login" }),
    encode({ ...raw, version: "2" }),
    encode({ ...raw, signer: normalizeSuiAddress("0x9") }),
  ]) {
    await assert.rejects(signer.sign(bytes), hasCode("invalid_command"));
  }
  assert.deepEqual(f.calls, ["fm_device_public"]);
  for (const nativeError of ["InvalidNodeCommand", "WrongSender"]) {
    const guarded = await NativeDeviceSigner.load(async (command, args) => {
      if (command === "fm_device_public") return f.invoke(command, args);
      throw nativeError;
    }, "primary");
    await assert.rejects(
      guarded.sign(nodeCommandSigningBytes(signed)),
      hasCode("invalid_command"),
    );
  }
});
test("native raw signatures snapshot asynchronous input and reject Sui serialized signatures", async () => {
  const f = fixture(),
    signer = await NativeDeviceSigner.load(f.invoke, "primary");
  const signed = await signNodeCommand(f.key, commandInput());
  const bytes = nodeCommandSigningBytes(signed),
    original = new Uint8Array(bytes);
  const pending = signer.sign(bytes);
  bytes.fill(9);
  assert.ok(await f.key.getPublicKey().verify(original, await pending));
  const bad = await NativeDeviceSigner.load(async (command, args) => {
    if (command === "fm_device_public") return f.invoke(command, args);
    return f.key.signTransaction(
      Uint8Array.from(atob(args.bytes), (b) => b.charCodeAt(0)),
    );
  }, "primary");
  await assert.rejects(bad.sign(original), hasCode("invalid_response"));
});
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
