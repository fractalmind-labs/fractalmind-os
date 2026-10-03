import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  fromBase64,
  toBase64,
  normalizeSuiAddress as id,
} from "@mysten/sui/utils";
import {
  createDeviceEncryptionKeys,
  encryptContent,
  decryptContent,
  unwrapKeys,
  hexToBytes,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDirectDraft, type DirectDraft } from "../src/direct-draft";
import type { NativeInvoke } from "../src/native-device";
import type { ConnectionProfile } from "../src/domain";

const profile: ConnectionProfile = {
  network: "localnet",
  chainIdentifier: "a".repeat(64),
  humanId: id("1"),
  rpcUrl: "http://127.0.0.1:1",
  packageId: id("2"),
  registryId: id("3"),
};
const org = id("4"),
  managed = {
    id: id("5"),
    instance_id: "native:instance-a",
    host_address: id("6"),
  };
const value: DirectDraft = {
  action: "file.write",
  message: "private question 一段草稿",
  content: "unpublished file contents",
  path: "docs/NEW.md",
  requestRoots: "docs",
  calls: "3",
};
function fixture() {
  const device = Ed25519Keypair.generate(),
    encryption = createDeviceEncryptionKeys();
  const values = new Map<string, string>();
  let denyStorage = false,
    ignoredWrite = false,
    calls: string[] = [];
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (denyStorage) throw new Error("quota");
      if (!ignoredWrite) values.set(key, value);
    },
    removeItem: (key: string) => {
      if (denyStorage) throw new Error("quota");
      values.delete(key);
    },
  };
  // Actual SDK cryptography with generated test-only keys, implementing the
  // existing native record wire format. No chain/network/signing is callable.
  const invoke: NativeInvoke = async (command, args) => {
    calls.push(command);
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: args.profile,
        address: device.toSuiAddress(),
        signingPublicKey: toBase64(device.getPublicKey().toRawBytes()),
        encryptionPublicKey: toBase64(encryption.publicKey),
      };
    assert.ok(
      ["fm_device_encrypt_record", "fm_device_decrypt_record"].includes(
        command,
      ),
    );
    const record = JSON.parse(args.record);
    const ringBytes = await unwrapKeys(
      fromBase64(record.encryptedKeys),
      encryption.secret,
      `fractalmind.device-keys.v1:${record.network}:${device.toSuiAddress()}`,
    );
    const ring = JSON.parse(new TextDecoder().decode(ringBytes));
    ringBytes.fill(0);
    const key = hexToBytes(
      ring.organizations[record.organizationId].historicalKeys[
        record.keyVersion
      ],
    );
    const context = `fractalmind.product-record.v1:${record.organizationId}:${record.kind}:${JSON.stringify(record.logicalId)}:${record.revision}:${record.keyVersion}`;
    try {
      return command === "fm_device_encrypt_record"
        ? toBase64(
            await encryptContent(fromBase64(record.plaintext), key, context),
          )
        : toBase64(
            await decryptContent(
              fromBase64(record.encryptedBody),
              key,
              context,
            ),
          );
    } finally {
      key.fill(0);
    }
  };
  const open = (
    p = profile,
    o = org,
    m = managed,
    d = "primary",
    transport = invoke,
    guard = () => {},
  ) => NativeDirectDraft.open(p, o, m, d, transport, storage, guard);
  return {
    values,
    storage,
    invoke,
    open,
    calls,
    deny: () => {
      denyStorage = true;
    },
    ignore: () => {
      ignoredWrite = true;
    },
  };
}

test("offline local draft survives a fresh controller with only ciphertext at rest and no signing/network", async () => {
  const f = fixture(),
    first = await f.open();
  assert.deepEqual(await first.restore(), { state: "empty" });
  await first.save(value);
  const raw = f.values.get(first.storageKey)!;
  assert.ok(!raw.includes(value.message) && !raw.includes(value.content));
  assert.ok(!raw.includes("contentKey") && !raw.includes("DeviceGrant"));
  const second = await f.open(),
    restored = await second.restore();
  assert.equal(restored.state, "saved");
  if (restored.state === "saved") assert.deepEqual(restored.draft, value);
  assert.deepEqual(
    new Set(f.calls),
    new Set([
      "fm_device_public",
      "fm_device_encrypt_record",
      "fm_device_decrypt_record",
    ]),
  );
});

test("network, chain, Human, organization, instance and device scope cannot inherit another draft", async () => {
  const f = fixture(),
    first = await f.open();
  await first.save(value);
  const raw = f.values.get(first.storageKey)!;
  const alternatives = [
    await f.open({ ...profile, network: "devnet" }),
    await f.open({ ...profile, chainIdentifier: "b".repeat(64) }),
    await f.open({ ...profile, humanId: id("7") }),
    await f.open(profile, id("8")),
    await f.open(profile, org, { ...managed, id: id("9") }),
    await f.open(profile, org, {
      ...managed,
      instance_id: "native:new-process",
    }),
    await f.open(profile, org, { ...managed, host_address: id("a") }),
    await f.open(profile, org, managed, "another-device-profile"),
    await f.open(profile, org, managed, "primary", fixture().invoke),
  ];
  for (const other of alternatives) {
    assert.notEqual(other.storageKey, first.storageKey);
    assert.deepEqual(await other.restore(), { state: "empty" });
    f.values.set(other.storageKey, raw);
    await assert.rejects(other.restore(), /draft_invalid/);
  }
});

test("altering metadata to a different scope cannot bypass ciphertext AAD binding", async () => {
  const f = fixture(),
    first = await f.open();
  await first.save(value);
  const other = await f.open({ ...profile, humanId: id("f") });
  await other.save({ ...value, message: "another" });
  const a = JSON.parse(f.values.get(first.storageKey)!),
    b = JSON.parse(f.values.get(other.storageKey)!);
  f.values.set(other.storageKey, JSON.stringify({ ...a, scope: b.scope }));
  await assert.rejects(other.restore());
});

test("failed or silently ignored storage writes never report a saved draft", async () => {
  for (const fail of ["deny", "ignore"] as const) {
    const f = fixture(),
      store = await f.open();
    f[fail]();
    await assert.rejects(store.save(value), /draft_storage_unavailable/);
    assert.deepEqual(await (await f.open()).restore(), { state: "empty" });
  }
});

test("closing or backgrounding during native encryption cannot persist or expose late results", async () => {
  const f = fixture();
  let active = true;
  const invoke: NativeInvoke = async (command, args) => {
    const result = await f.invoke(command, args);
    if (command === "fm_device_encrypt_record") active = false;
    return result;
  };
  const store = await f.open(profile, org, managed, "primary", invoke, () => {
    if (!active) throw new Error("state_changed");
  });
  await assert.rejects(store.save(value), /state_changed/);
  assert.equal(f.values.size, 0);
});

test("a submission attempt, including unknown outcome, is never restored as an unsent message", async () => {
  const f = fixture(),
    store = await f.open();
  await store.save(value);
  store.markAttempted("direct-message:original");
  const count = f.calls.length;
  assert.deepEqual(await (await f.open()).restore(), {
    state: "attempted",
    requestId: "direct-message:original",
  });
  assert.deepEqual(f.calls.slice(count), ["fm_device_public"]);
  // An intentional new draft does not submit or restore the original request.
  await store.save({ ...value, message: "a new explicitly saved draft" });
  const next = await (await f.open()).restore();
  assert.equal(next.state, "saved");
  if (next.state === "saved")
    assert.equal(next.draft.message, "a new explicitly saved draft");
});

test("another window's save, deletion or submission prevents overwriting and submitting stale drafts", async () => {
  const f = fixture(),
    a = await f.open(),
    b = await f.open();
  await a.save(value);
  await assert.rejects(b.save(value), /draft_changed/);
  assert.throws(() => b.markAttempted("original"), /draft_changed/);
  await b.restore();
  a.discard();
  await assert.rejects(b.save(value), /draft_changed/);
  await b.restore();
  const c = await f.open();
  b.markAttempted("original-unsaved");
  await assert.rejects(c.save(value), /draft_changed/);
});

test("a late save cannot resurrect a draft after its same-session submission", async () => {
  const f = fixture();
  let atEncryption!: () => void, resume!: () => void;
  const arrived = new Promise<void>((r) => {
    atEncryption = r;
  });
  const paused = new Promise<void>((r) => {
    resume = r;
  });
  const store = await f.open(
    profile,
    org,
    managed,
    "primary",
    async (command, args) => {
      const result = await f.invoke(command, args);
      if (command === "fm_device_encrypt_record") {
        atEncryption();
        await paused;
      }
      return result;
    },
  );
  const save = store.save(value);
  await arrived;
  store.markAttempted("original-in-flight");
  resume();
  await assert.rejects(save, /draft_changed/);
  assert.deepEqual(await store.restore(), {
    state: "attempted",
    requestId: "original-in-flight",
  });
});

test("tampering, missing native device and oversized drafts stay unavailable without replacing keys", async () => {
  const f = fixture(),
    store = await f.open();
  await store.save(value);
  const saved = JSON.parse(f.values.get(store.storageKey)!);
  const encrypted = fromBase64(saved.encryptedBody);
  encrypted[20] ^= 1;
  f.values.set(
    store.storageKey,
    JSON.stringify({ ...saved, encryptedBody: toBase64(encrypted) }),
  );
  await assert.rejects(store.restore());
  await assert.rejects(
    store.save({ ...value, content: "x".repeat(66000) }),
    /draft_invalid/,
  );
  const commands: string[] = [];
  await assert.rejects(
    f.open(profile, org, managed, "absent", async (command) => {
      commands.push(command);
      throw "NotInitialized";
    }),
    /not_initialized/,
  );
  assert.deepEqual(commands, ["fm_device_public"]);
});
