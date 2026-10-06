import test from "node:test";
import assert from "node:assert/strict";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  fromBase64,
  toBase64,
  normalizeSuiAddress,
  deriveDynamicFieldID,
} from "@mysten/sui/utils";
import {
  createRecoveryCode,
  recoveryKeys,
  wrapKeys,
  MemoryTransactionJournal,
  IdentityRegistryBcs,
  HumanIdentityBcs,
  RecoveryRecordBcs,
  RecoveryLocationBcs,
  type SelfPayFeeQuote,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  NativeImportedRecoverySigner,
  recoveryFingerprint,
} from "../src/native-recovery";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { IdentityRecovery } from "../src/recovery";
import { OrganizationBcs } from "../src/device-identity";

async function fixture() {
  const id = normalizeSuiAddress,
    profile = "test-recovery",
    network = "localnet" as const;
  const oldCode = createRecoveryCode(network),
    nextCode = createRecoveryCode(network),
    old = recoveryKeys(oldCode),
    next = recoveryKeys(nextCode),
    device = Ed25519Keypair.generate();
  const describe = (key: Ed25519Keypair, enc: Uint8Array) => ({
    format: 1,
    profile,
    address: key.toSuiAddress(),
    signingPublicKey: key.getPublicKey().toBase64(),
    encryptionPublicKey: toBase64(enc),
  });
  const devicePub = describe(device, new Uint8Array(32).fill(4)),
    oldPub = describe(old.signer, old.encryptionPublicKey),
    nextPub = describe(next.signer, next.encryptionPublicKey);
  const envelope = toBase64(
    await wrapKeys(new Uint8Array([1]), next.encryptionPublicKey, "fixture"),
  );
  const imported = { format: 1, network, device: devicePub, recovery: oldPub };
  let staged: any = null,
    wrongSignature = false,
    wrongBytes = false,
    wrongFingerprint = false;
  const calls: string[] = [];
  const invoke: NativeInvoke = async (command, args) => {
    calls.push(command);
    if (
      command === "fm_recovery_import" ||
      command === "fm_recovery_imported_public"
    )
      return structuredClone(imported);
    if (command === "fm_device_public") return structuredClone(devicePub);
    if (command === "fm_recovery_prepared_public") {
      if (!staged) throw "NotInitialized";
      return structuredClone({
        ...staged,
        sourceFingerprint: wrongFingerprint
          ? "0".repeat(64)
          : staged.sourceFingerprint,
      });
    }
    if (command === "fm_recovery_prepare") {
      const source = JSON.parse(args.source);
      staged = {
        imported,
        nextRecovery: nextPub,
        encryptedBackup: envelope,
        encryptedDeviceKeys: envelope,
        sourceFingerprint: await recoveryFingerprint(source),
        rotations: source.organizations
          .filter((o: any) => o.rotate)
          .map((o: any) => ({
            organizationId: o.organizationId,
            oldVersion: o.keyVersion,
            newVersion: (BigInt(o.keyVersion) + 1n).toString(),
          })),
      };
      return { public: structuredClone(staged), recoveryCode: nextCode };
    }
    if (command === "fm_recovery_sign_transaction") {
      const bytes = fromBase64(args.bytes);
      if (wrongBytes) bytes[0] ^= 1;
      return (wrongSignature ? device : old.signer).signTransaction(bytes);
    }
    throw new Error("Unexpected native operation");
  };
  const signer = await NativeImportedRecoverySigner.import(
    invoke,
    profile,
    network,
    oldCode,
  );
  const native = await NativeDeviceSigner.load(invoke, profile);
  const packageId = id("0x10"),
    protocolId = id("0x11"),
    registryId = id("0x12"),
    humanId = id("0x13"),
    recordId = id("0x14"),
    orgId = id("0x15");
  const table = (n: string) => ({ id: id(n), size: "1" });
  const registry = {
    id: registryId,
    protocol_registry: protocolId,
    recoveries: table("0x21"),
    devices: table("0x22"),
  };
  const human = {
    id: humanId,
    registry_id: registryId,
    network,
    generation: "1",
    recovery_version: "1",
    recovery_record: recordId,
    recovery_address: oldPub.address,
    admin_caps: table("0x23"),
    roles: table("0x24"),
    organizations: [orgId],
    grants: [] as string[],
  };
  const record = {
    id: recordId,
    human_id: humanId,
    registry_id: registryId,
    format_version: 1,
    network,
    version: "1",
    active: true,
    recovery_address: oldPub.address,
    signing_public_key: [...fromBase64(oldPub.signingPublicKey)],
    encryption_public_key: [...fromBase64(oldPub.encryptionPublicKey)],
    encrypted_backup: [...fromBase64(envelope)],
    backup_version: "1",
  };
  const org = {
    id: orgId,
    name: "Organization",
    description: "",
    admin: humanId,
    is_active: true,
    agents: table("0x25"),
    agent_count: "0",
    tasks: table("0x26"),
    task_count: "0",
    parent_org: null,
    child_orgs: table("0x27"),
    child_org_count: "0",
    depth: "0",
    created_at: "1",
  };
  const controller = new IdentityRecovery(
    {
      network,
      rpcUrl: "http://127.0.0.1:29000",
      packageId,
      registryId: protocolId,
      chainIdentifier: "TestChain1",
    },
    signer,
    native,
    new MemoryTransactionJournal(),
  );
  let invalid: "none" | "type" | "owner" | "uid" | "network" | "location" =
      "none",
    missing: "none" | "exact" | "child" = "none";
  let version = 1,
    keyVersion = "1",
    readCalls = 0,
    quoteCalls = 0,
    submitCalls = 0,
    changeDuringQuote = false;
  const core = controller.client.core as any;
  core.getChainIdentifier = async () => ({ chainIdentifier: "TestChain1" });
  core.getDynamicField = async () => {
    if (missing !== "none")
      throw {
        reason: "notFound",
        objectId:
          missing === "exact"
            ? deriveDynamicFieldID(
                registry.recoveries.id,
                { address: null },
                bcs.Address.serialize(oldPub.address).toBytes(),
              )
            : id("0x99"),
      };
    return {
      dynamicField: {
        value: {
          type: `${packageId}::identity::${invalid === "location" ? "Other" : "RecoveryLocation"}`,
          bcs: RecoveryLocationBcs.serialize({
            human_id: humanId,
            record_id: recordId,
            version: "1",
          }).toBytes(),
        },
      },
    };
  };
  core.getObject = async ({ objectId }: { objectId: string }) => {
    readCalls++;
    const data =
      objectId === registryId
        ? {
            value: registry,
            type: "identity::IdentityRegistry",
            codec: IdentityRegistryBcs,
          }
        : objectId === humanId
          ? {
              value: {
                ...human,
                ...(invalid === "uid" ? { id: id("0x99") } : {}),
                ...(invalid === "network" ? { network: "mainnet" } : {}),
              },
              type: "identity::HumanIdentity",
              codec: HumanIdentityBcs,
            }
          : objectId === recordId
            ? {
                value: record,
                type: "identity::RecoveryRecord",
                codec: RecoveryRecordBcs,
              }
            : {
                value: org,
                type: "organization::Organization",
                codec: OrganizationBcs,
              };
    return {
      object: {
        objectId,
        type: `${invalid === "type" ? id("0x99") : packageId}::${data.type}`,
        owner: { $kind: invalid === "owner" ? "AddressOwner" : "Shared" },
        version: String(version),
        content: (data.codec as any).serialize(data.value).toBytes(),
      },
    };
  };
  controller.sdk.identity.resolveRegistry = async () => registryId;
  controller.sdk.productRecord.listCurrent = async () => ({
    records: [],
    keyVersion,
    cursor: null,
    hasNextPage: false,
  });
  controller.manager.query = async () => undefined;
  controller.manager.prepare = async ({ requestId }) => {
    quoteCalls++;
    if (changeDuringQuote) version++;
    return { requestId } as SelfPayFeeQuote;
  };
  controller.manager.submit = async () => {
    submitCalls++;
    return { status: "confirmed", digest: "fixture", actualGas: "1" } as any;
  };
  return {
    controller,
    signer,
    invoke,
    calls,
    oldCode,
    nextCode,
    orgId,
    human,
    record,
    org,
    registry,
    count: () => ({ readCalls, quoteCalls, submitCalls }),
    invalidate: (mode: typeof invalid) => {
      invalid = mode;
    },
    missing: (mode: typeof missing) => {
      missing = mode;
    },
    change: () => {
      version++;
    },
    duringQuote: () => {
      changeDuringQuote = true;
    },
    keyVersion: (value: string) => {
      keyVersion = value;
    },
    fingerprint: () => {
      wrongFingerprint = true;
    },
    signature: (bytes: boolean) => {
      wrongBytes = bytes;
      wrongSignature = !bytes;
    },
    stage: () => staged,
  };
}
test("recovery bridge loads public prepared credentials without exporting backup codes and verifies exact native signatures", async () => {
  const f = await fixture();
  assert.equal(await f.signer.loadStage(), null);
  const value = await f.controller.prepareReplacement();
  assert.equal(value.recoveryCode, f.nextCode);
  const stage = await f.signer.loadStage();
  assert.equal("recoveryCode" in stage!, false);
  assert.ok(Object.isFrozen(stage!.rotations));
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal((await f.signer.signTransaction(bytes)).bytes, toBase64(bytes));
  f.signature(false);
  await assert.rejects(f.signer.signTransaction(bytes), /invalid_response/);
  f.signature(true);
  await assert.rejects(f.signer.signTransaction(bytes), /invalid_response/);
  assert.equal(f.calls.includes("fm_device_initialize"), false);
});
test("recovery sources require exact shared objects, UID/network binding and typed address directory", async () => {
  for (const mode of ["type", "owner", "uid", "network", "location"] as const) {
    const f = await fixture();
    f.invalidate(mode);
    await assert.rejects(f.controller.inspect(), /invalid_source/);
    assert.equal(f.calls.includes("fm_recovery_prepare"), false);
  }
  const absent = await fixture();
  absent.missing("exact");
  await assert.rejects(absent.controller.inspect(), /code_not_found/);
  const child = await fixture();
  child.missing("child");
  await assert.rejects(
    child.controller.inspect(),
    (error: any) =>
      error.reason === "notFound" && error.message !== "code_not_found",
  );
});
test("recovery rotates active owned organizations only and rejects changed backup/key versions before quotation", async () => {
  const member = await fixture();
  member.org.admin = normalizeSuiAddress("0x99");
  assert.equal(
    (await member.controller.prepareReplacement()).stage.rotations.length,
    0,
  );
  const inactive = await fixture();
  inactive.org.is_active = false;
  assert.equal(
    (await inactive.controller.prepareReplacement()).stage.rotations.length,
    0,
  );
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.record.backup_version = "2";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.keyVersion("2");
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.fingerprint();
    },
  ]) {
    const f = await fixture();
    await f.controller.prepareReplacement();
    mutate(f);
    await assert.rejects(f.controller.prepare(true), /source_changed/);
    assert.equal(f.count().quoteCalls, 0);
  }
});
test("a recovery quote never submits and source changes before/after simulation or confirmation block submission", async () => {
  const f = await fixture();
  await f.controller.prepareReplacement();
  await assert.rejects(f.controller.prepare(false), /backup_not_confirmed/);
  const quote = await f.controller.prepare(true);
  assert.ok(!("status" in quote));
  assert.equal(f.count().submitCalls, 0);
  f.change();
  await assert.rejects(f.controller.submit(quote, true), /source_changed/);
  assert.equal(f.count().submitCalls, 0);
  const changed = await fixture();
  await changed.controller.prepareReplacement();
  changed.duringQuote();
  await assert.rejects(changed.controller.prepare(true), /source_changed/);
  assert.equal(changed.count().submitCalls, 0);
});
test("unknown/confirmed original recovery is queried before any source read or new key preparation", async () => {
  for (const status of ["unknown", "confirmed"] as const) {
    const f = await fixture();
    const prior = { status, digest: "original" } as any;
    f.controller.manager.query = async () => prior;
    const before = f.count();
    assert.equal(await f.controller.prepare(true), prior);
    assert.deepEqual(f.count(), before);
    await assert.rejects(
      f.controller.prepareReplacement(),
      /original_transaction_exists/,
    );
    assert.equal(f.calls.includes("fm_recovery_prepare"), false);
  }
});
test("a consumed recovery code cannot adopt another attempt's winning identity/device", async () => {
  const f = await fixture();
  await f.controller.prepareReplacement();
  f.record.active = false;
  f.human.recovery_version = "2";
  f.human.recovery_address = normalizeSuiAddress("0x99");
  await assert.rejects(f.controller.inspect(), /code_consumed/);
  assert.equal(f.calls.includes("fm_device_prove"), false);
});
