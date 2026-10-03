/** Generated, isolated credentials only. Uses the production NativeRecoverySigner
 * and IdentityCreation; no JS private signer is used to submit either transaction. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { Transaction } from "@mysten/sui/transactions";
import { PrivateRecords } from "../src/private-records";
import { ChainReadSession } from "../src/chain";
import { DeviceIdentityVerifier } from "../src/device-identity";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  recoveryKeys,
  unwrapKeys,
  MemoryTransactionJournal,
  TransactionPreflightError,
  SelfPayTransactionManager,
  RecoveryLocationBcs,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { NativeRecoverySigner } from "../src/native-onboarding";
import { IdentityCreation, normalizeDeployment } from "../src/onboarding";
assert.ok(
  process.argv[2] && process.argv[3],
  "Pass deployment and output reports",
);
const deployment = JSON.parse(await readFile(process.argv[2], "utf8"));
const profile = `test-${randomUUID()}`,
  helper = resolve("native/target/debug/examples/device-test-helper");
const rpc = "http://127.0.0.1:29000",
  faucet = "http://127.0.0.1:29123";
function request(action: string, extra: Record<string, string> = {}) {
  const result = spawnSync(helper, [], {
    input: JSON.stringify({ action, profile, ...extra }),
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1500000,
  });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Native helper failed");
  return JSON.parse(result.stdout);
}
const invoke: NativeInvoke = async (command, args) => {
  assert.equal(args.profile, profile);
  switch (command) {
    case "fm_onboarding_create":
      return request("createOnboarding", { network: args.network });
    case "fm_onboarding_public":
      return request("publicOnboarding", { network: args.network });
    case "fm_onboarding_sign_transaction":
      return request("signOnboarding", {
        network: args.network,
        bytes: args.bytes,
      });
    case "fm_device_public":
      return request("public");
    case "fm_device_prove":
      return request("proveDevice", { challenge: args.challenge });
    case "fm_device_sign_transaction":
      return request("signTransaction", { bytes: args.bytes });
    default:
      throw new Error("Unexpected initializer in production creation flow");
  }
};
const checks: string[] = [],
  transactions: unknown[] = [];
const recoveryProfiles = [profile + "-a", profile + "-b", profile + "-used"];
try {
  await assert.rejects(
    NativeRecoverySigner.load(invoke, profile, "localnet"),
    /not_initialized/,
  );
  checks.push("loading an absent onboarding profile does not create keys");
  const result = await NativeRecoverySigner.create(invoke, profile, "localnet");
  const recovery = result.signer,
    device = await NativeDeviceSigner.load(invoke, profile);
  // The one-shot code is an explicit backup credential. Independent JS derivation
  // is an interoperability test only, never the signer used by the controller.
  const independent = recoveryKeys(result.recoveryCode, "localnet");
  assert.equal(independent.address, recovery.material.recovery.address);
  assert.equal(
    toBase64(independent.encryptionPublicKey),
    recovery.material.recovery.encryptionPublicKey,
  );
  const backup = await unwrapKeys(
    fromBase64(recovery.material.encryptedBackup),
    independent.encryptionSecret,
    `fractalmind.recovery-backup.v1:localnet:${independent.address}`,
  );
  const keyring = JSON.parse(new TextDecoder().decode(backup));
  assert.equal(keyring.format, 1);
  assert.match(keyring.contentKey, /^[0-9a-f]{64}$/);
  assert.equal(keyring.historicalKeys["1"], keyring.contentKey);
  backup.fill(0);
  independent.encryptionSecret.fill(0);
  checks.push(
    "native recovery code/HKDF keys and FMW1/AES-GCM backup interoperate with the official JS path",
  );
  const reloaded = await NativeRecoverySigner.load(invoke, profile, "localnet");
  assert.deepEqual(reloaded.material.device, recovery.material.device);
  assert.deepEqual(reloaded.material.recovery, recovery.material.recovery);
  assert.notEqual(
    reloaded.material.encryptedBackup,
    recovery.material.encryptedBackup,
  );
  assert.equal("recoveryCode" in reloaded.material, false);
  assert.throws(
    () => request("createOnboarding", { network: "localnet" }),
    /AlreadyInitialized/,
  );
  assert.throws(
    () => request("publicOnboarding", { network: "mainnet" }),
    /InvalidRecovery/,
  );
  checks.push(
    "fresh-process reload reveals public keys/ciphertext only; re-creation and wrong network are rejected",
  );
  const journal = new MemoryTransactionJournal();
  const profileData = normalizeDeployment({
    network: "localnet",
    rpcUrl: rpc,
    packageId: deployment.packageId,
    registryId: deployment.registryId,
    chainIdentifier: deployment.chain.chainIdentifier,
  });
  let creation = new IdentityCreation(profileData, recovery, device, journal);
  assert.equal(await creation.locate(), null);
  await assert.rejects(
    creation.prepareIdentity(),
    (e) => e instanceof TransactionPreflightError && e.code === "needs_funds",
  );
  checks.push(
    "zero recovery balance blocks Human preparation without submitting",
  );
  for (const recipient of [
    recovery.material.recovery.address,
    device.device.address,
  ])
    await requestSuiFromFaucetV2({ host: faucet, recipient });
  assert.equal(
    await creation.queryIdentity(),
    undefined,
    "funding does not submit",
  );
  const quote = await creation.prepareIdentity();
  assert.ok(!("status" in quote));
  const humanResult = await creation.submitIdentity(quote);
  assert.equal(humanResult.status, "confirmed");
  transactions.push({
    action: "create Human with native recovery signature and self-paid Gas",
    digest: humanResult.digest,
    actualGas: humanResult.actualGas,
  });
  async function visible(requireOrganization = false) {
    const end = Date.now() + 15000;
    while (true) {
      try {
        const found = await creation.locate();
        if (found && (!requireOrganization || found.organizations.length === 1))
          return found;
      } catch {}
      if (Date.now() >= end) throw new Error("Human not visible");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const found = await visible();
  assert.equal(found.organizations.length, 0);
  assert.equal((await creation.queryIdentity())!.digest, humanResult.digest);
  checks.push(
    "native recovery signs a real self-paid Human transaction; independent device possession resolves stable Human",
  );
  const orgQuote = await creation.prepareOrganization(
    `Native-onboarding-${Date.now()}`,
  );
  assert.ok(!("status" in orgQuote));
  const orgResult = await creation.submitOrganization(orgQuote);
  assert.equal(orgResult.status, "confirmed");
  transactions.push({
    action: "create personal organization with independent native device",
    digest: orgResult.digest,
    actualGas: orgResult.actualGas,
  });
  creation = new IdentityCreation(
    profileData,
    await NativeRecoverySigner.load(invoke, profile, "localnet"),
    await NativeDeviceSigner.load(invoke, profile),
    journal,
  );
  const restored = await visible(true);
  assert.equal(restored.profile.humanId, found.profile.humanId);
  assert.equal(restored.organizations.length, 1);
  assert.equal((await creation.queryOrganization())!.digest, orgResult.digest);
  assert.equal(
    ((await creation.prepareIdentity()) as { digest: string }).digest,
    humanResult.digest,
  );
  assert.equal(
    (
      (await creation.prepareOrganization("must not duplicate")) as {
        digest: string;
      }
    ).digest,
    orgResult.digest,
  );
  checks.push(
    "new native processes and a rebuilt controller query original digests and reconstruct the same Human/organization without replay",
  );
  // Clear all technical journal data and reconstruct from chain directory + OS
  // credentials. Confirmed business state must not depend on the journal.
  creation = new IdentityCreation(
    profileData,
    reloaded,
    device,
    new MemoryTransactionJournal(),
  );
  const noCache = await creation.locate();
  assert.equal(noCache!.profile.humanId, found.profile.humanId);
  assert.equal(noCache!.organizations.length, 1);
  await assert.rejects(creation.prepareIdentity(), /already exists/);
  await assert.rejects(
    creation.prepareOrganization("duplicate"),
    /already exists/,
  );
  checks.push(
    "discarding transaction caches reconstructs confirmed business state from chain and refuses duplicate creation",
  );
  const organizationId = noCache!.organizations[0].objectId;
  const stableHuman = noCache!.profile.humanId;
  const identityRegistryId = await creation.sdk.identity.resolveRegistry();
  const registry = await creation.sdk.identity.getRegistry(identityRegistryId);
  const recordInput = {
    network: "localnet",
    organizationId,
    kind: 1,
    logicalId: "recovered-native-history",
    revision: "1",
    keyVersion: "1",
  };
  const expected = new TextEncoder().encode(
    "Historical body retained after recovery",
  );
  const originalCipher = request("encryptRecord", {
    record: JSON.stringify({
      ...recordInput,
      encryptedKeys: recovery.material.encryptedDeviceKeys,
      plaintext: toBase64(expected),
    }),
  });
  const historicalQuote = await creation.deviceManager.prepare({
    requestId: `recovery-history:${profile}`,
    gasBudget: 200_000_000n,
    transaction: creation.sdk.productRecord.save({
      organizationId,
      humanId: stableHuman,
      grantId: noCache!.grantId,
      kind: "okr",
      logicalId: recordInput.logicalId,
      expectedRevision: 0,
      keyVersion: 1,
      encryptedBody: fromBase64(originalCipher),
    }),
  });
  const historical = await creation.deviceManager.submit(historicalQuote);
  assert.equal(historical.status, "confirmed");
  transactions.push({
    action: "save historical body with native content key/signature",
    digest: historical.digest,
    actualGas: historical.actualGas,
  });
  async function wait<T>(
    read: () => Promise<T>,
    ready: (value: T) => boolean,
  ): Promise<T> {
    const until = Date.now() + 15000;
    while (true) {
      const value = await read();
      if (ready(value)) return value;
      if (Date.now() >= until)
        throw new Error("Expected chain state not visible");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  function deviceInvoke(target: string): NativeInvoke {
    return async (command, args) => {
      assert.equal(args.profile, target);
      if (command === "fm_device_public")
        return request("public", { profile: target });
      if (command === "fm_device_prove")
        return request("proveDevice", {
          profile: target,
          challenge: args.challenge,
        });
      if (command === "fm_device_sign_transaction")
        return request("signTransaction", {
          profile: target,
          bytes: args.bytes,
        });
      if (command === "fm_device_decrypt_record")
        return request("decryptRecord", {
          profile: target,
          record: args.record,
        });
      if (command === "fm_device_encrypt_record")
        return request("encryptRecord", {
          profile: target,
          record: args.record,
        });
      throw new Error("Unsupported test device operation");
    };
  }
  // Isolated test adapter for the new native recovery primitive. The installed
  // App recovery controller/IPC/UI is not yet wired and is not claimed here.
  function recoverySigner(target: string, pub: any) {
    return {
      getPublicKey: () =>
        new Ed25519PublicKey(fromBase64(pub.signingPublicKey)),
      async signTransaction(bytes: Uint8Array) {
        const encoded = toBase64(new Uint8Array(bytes));
        const signed = request("signRecovery", {
          profile: target,
          network: "localnet",
          phase: "old",
          bytes: encoded,
        });
        assert.equal(signed.bytes, encoded);
        await verifyTransactionSignature(bytes, signed.signature, {
          address: pub.address,
        });
        return signed;
      },
    };
  }
  let currentCode = result.recoveryCode;
  let oldDevice = device,
    oldGrant = noCache!.grantId;
  let sourceRecoveryAddress = recovery.material.recovery.address;
  let publicRecovered: any;
  for (let round = 0; round < 2; round++) {
    const target = recoveryProfiles[round];
    assert.throws(
      () =>
        request("publicImportedRecovery", {
          profile: target,
          network: "localnet",
        }),
      /NotInitialized/,
    );
    assert.throws(
      () =>
        request("importRecovery", {
          profile: target,
          network: "mainnet",
          code: currentCode,
        }),
      /InvalidRecovery/,
    );
    assert.throws(
      () => request("public", { profile: target }),
      /NotInitialized/,
    );
    // Existing devices cannot be silently reused as a supposedly fresh recovery device.
    if (round === 0)
      assert.throws(
        () =>
          request("importRecovery", { network: "localnet", code: currentCode }),
        /AlreadyInitialized/,
      );
    const imported = request("importRecovery", {
      profile: target,
      network: "localnet",
      code: currentCode,
    });
    assert.throws(
      () =>
        request("createOnboarding", { profile: target, network: "localnet" }),
      /AlreadyInitialized/,
    );
    assert.equal(imported.recovery.address, sourceRecoveryAddress);
    assert.notEqual(imported.device.address, oldDevice.device.address);
    assert.throws(
      () =>
        request("importRecovery", {
          profile: target,
          network: "localnet",
          code: currentCode,
        }),
      /AlreadyInitialized/,
    );
    assert.equal(
      "recoveryCode" in
        request("publicImportedRecovery", {
          profile: target,
          network: "localnet",
        }),
      false,
    );
    const locationResponse = await creation.client.core.getDynamicField({
      parentId: registry.recoveries.id,
      name: {
        type: "address",
        bcs: bcs.Address.serialize(imported.recovery.address).toBytes(),
      },
    });
    const location = RecoveryLocationBcs.parse(
      locationResponse.dynamicField.value.bcs,
    );
    const oldRecord = await creation.sdk.identity.getRecoveryRecord(
      location.record_id,
    );
    const oldHuman = await creation.sdk.identity.getHuman(location.human_id);
    assert.equal(oldHuman.id, stableHuman);
    assert.equal(oldRecord.active, true);
    assert.equal(oldHuman.recovery_record, oldRecord.id);
    const source = {
      chainIdentifier: profileData.chainIdentifier,
      registryId: identityRegistryId,
      humanId: stableHuman,
      recoveryRecordId: oldRecord.id,
      recoveryVersion: oldRecord.version,
      backupVersion: oldRecord.backup_version,
      generation: oldHuman.generation,
      encryptedBackup: toBase64(Uint8Array.from(oldRecord.encrypted_backup)),
      organizations: [
        { organizationId, keyVersion: String(round + 1), rotate: true },
      ],
    };
    assert.throws(
      () =>
        request("prepareRecovery", {
          profile: target,
          network: "localnet",
          source: JSON.stringify({
            ...source,
            encryptedBackup: source.encryptedBackup.slice(0, -4) + "AAAA",
          }),
        }),
      /InvalidEnvelope/,
    );
    const prepared = request("prepareRecovery", {
      profile: target,
      network: "localnet",
      source: JSON.stringify(source),
    });
    const reload = request("publicPreparedRecovery", {
      profile: target,
      network: "localnet",
    });
    assert.deepEqual(reload.nextRecovery, prepared.public.nextRecovery);
    assert.equal(reload.sourceFingerprint, prepared.public.sourceFingerprint);
    assert.notEqual(reload.encryptedBackup, prepared.public.encryptedBackup);
    assert.equal("recoveryCode" in reload, false);
    assert.throws(
      () =>
        request("prepareRecovery", {
          profile: target,
          network: "localnet",
          source: JSON.stringify(source),
        }),
      /AlreadyInitialized/,
    );
    assert.deepEqual(reload.rotations, [
      {
        organizationId,
        oldVersion: String(round + 1),
        newVersion: String(round + 2),
      },
    ]);
    const independentNext = recoveryKeys(prepared.recoveryCode, "localnet");
    assert.equal(independentNext.address, reload.nextRecovery.address);
    const nextPlain = await unwrapKeys(
      fromBase64(reload.encryptedBackup),
      independentNext.encryptionSecret,
      `fractalmind.recovery-backup.v1:localnet:${reload.nextRecovery.address}`,
    );
    const scoped = JSON.parse(new TextDecoder().decode(nextPlain));
    nextPlain.fill(0);
    independentNext.encryptionSecret.fill(0);
    assert.equal(scoped.format, 2);
    assert.equal(
      scoped.organizations[organizationId].currentVersion,
      String(round + 2),
    );
    assert.equal(
      scoped.organizations[organizationId].historicalKeys["1"],
      keyring.contentKey,
    );
    assert.notEqual(
      scoped.organizations[organizationId].contentKey,
      keyring.contentKey,
    );
    checks.push(
      `recovery ${round + 1}: checksum/network validation, fresh device, public address lookup, backup authentication, one-shot replacement code and native per-org key rotation`,
    );
    const managerJournal = new MemoryTransactionJournal();
    const manager = new SelfPayTransactionManager({
      client: creation.client,
      network: "localnet",
      signer: recoverySigner(target, imported.recovery),
      journal: managerJournal,
    });
    const tx = new Transaction();
    creation.sdk.productRecord.rotateKeyForRecovery({
      tx,
      organizationId,
      humanId: stableHuman,
      recordId: oldRecord.id,
      expectedKeyVersion: round + 1,
    });
    creation.sdk.identity.recoverIdentity({
      tx,
      identityRegistryId,
      humanId: stableHuman,
      recordId: oldRecord.id,
      recoverySigningKey: fromBase64(reload.nextRecovery.signingPublicKey),
      recoveryEncryptionKey: fromBase64(
        reload.nextRecovery.encryptionPublicKey,
      ),
      encryptedBackup: fromBase64(reload.encryptedBackup),
      device: imported.device.address,
      deviceEncryptionKey: fromBase64(imported.device.encryptionPublicKey),
      encryptedDeviceKeys: fromBase64(reload.encryptedDeviceKeys),
    });
    const requestId = `recover:${target}`;
    if (round === 1) {
      await assert.rejects(
        manager.prepare({
          requestId,
          transaction: tx,
          gasBudget: 200_000_000n,
        }),
        (e) =>
          e instanceof TransactionPreflightError && e.code === "needs_funds",
      );
      await requestSuiFromFaucetV2({
        host: faucet,
        recipient: imported.recovery.address,
      });
      checks.push(
        "new recovery address with zero SUI blocks a second recovery quote until explicit fixture funding",
      );
    }
    const quote = await manager.prepare({
      requestId,
      transaction: tx,
      gasBudget: 200_000_000n,
    });
    assert.equal(await manager.query(requestId), undefined);
    const recovered = await manager.submit(quote);
    assert.equal(recovered.status, "confirmed");
    transactions.push({
      action: `recover ${round + 1} with native old-recovery signature and atomic owned-org key rotation`,
      digest: recovered.digest,
      actualGas: recovered.actualGas,
    });
    assert.equal(
      (await new SelfPayTransactionManager({
        client: creation.client,
        network: "localnet",
        signer: recoverySigner(target, imported.recovery),
        journal: managerJournal,
      }).query(requestId))!.digest,
      recovered.digest,
    );
    const current = await wait(
      () => creation.sdk.identity.getHuman(stableHuman),
      (h) => h.recovery_address === reload.nextRecovery.address,
    );
    assert.equal(BigInt(current.generation), BigInt(oldHuman.generation) + 1n);
    assert.equal(
      BigInt(current.recovery_version),
      BigInt(oldHuman.recovery_version) + 1n,
    );
    assert.deepEqual(current.organizations, oldHuman.organizations);
    assert.equal(
      (await creation.sdk.identity.getRecoveryRecord(oldRecord.id)).active,
      false,
    );
    await assert.rejects(
      creation.sdk.identity.locateRecovery(currentCode, "localnet"),
      /consumed/,
    );
    const replay = creation.sdk.identity.recoverIdentity({
      identityRegistryId,
      humanId: stableHuman,
      recordId: oldRecord.id,
      recoverySigningKey: fromBase64(reload.nextRecovery.signingPublicKey),
      recoveryEncryptionKey: fromBase64(
        reload.nextRecovery.encryptionPublicKey,
      ),
      encryptedBackup: fromBase64(reload.encryptedBackup),
      device: imported.device.address,
      deviceEncryptionKey: fromBase64(imported.device.encryptionPublicKey),
      encryptedDeviceKeys: fromBase64(reload.encryptedDeviceKeys),
    });
    await assert.rejects(
      manager.prepare({
        requestId: `replay:${target}`,
        transaction: replay,
        gasBudget: 200_000_000n,
      }),
    );
    const chain = new ChainReadSession(noCache!.profile);
    await assert.rejects(
      new DeviceIdentityVerifier(chain, oldDevice, oldGrant).verify(),
    );
    const native = await NativeDeviceSigner.load(deviceInvoke(target), target);
    const identity = await wait(
      () => chain.human(),
      (h) =>
        Boolean(
          h.grants.value?.find(
            (g) =>
              g.device === native.device.address &&
              g.generation === current.generation,
          ),
        ),
    );
    const grant = identity.grants.value!.find(
      (g) =>
        g.device === native.device.address &&
        g.generation === current.generation,
    )!;
    await new DeviceIdentityVerifier(
      chain,
      native,
      grant.id,
    ).verifyOrganization(organizationId, "approve");
    const bodies = new PrivateRecords(
      chain,
      native,
      grant.id,
      organizationId,
      deviceInvoke(target),
    );
    const rows = await wait(
      () => bodies.list(),
      (rows) => rows.some((r) => r.logicalId === recordInput.logicalId),
    );
    const historicalPlain = await bodies.read(
      rows.find((r) => r.logicalId === recordInput.logicalId)!,
    );
    assert.deepEqual(historicalPlain, expected);
    historicalPlain.fill(0);
    checks.push(
      `recovery ${round + 1}: actual chain consumes old code, advances Human generation, retains org IDs, invalidates previous devices, rejects replay and reads historical ciphertext from chain`,
    );
    if (round === 0) {
      const newBody = new TextEncoder().encode(
        "Future body protected by new organization key",
      );
      const bodyHeader = {
        ...recordInput,
        logicalId: "post-recovery-body",
        keyVersion: "2",
      };
      const futureCipher = request("encryptRecord", {
        profile: target,
        record: JSON.stringify({
          ...bodyHeader,
          encryptedKeys: toBase64(Uint8Array.from(grant.encrypted_keys)),
          plaintext: toBase64(newBody),
        }),
      });
      assert.throws(
        () =>
          request("decryptRecord", {
            record: JSON.stringify({
              ...bodyHeader,
              encryptedKeys: recovery.material.encryptedDeviceKeys,
              encryptedBody: futureCipher,
            }),
          }),
        /InvalidEnvelope/,
      );
      await requestSuiFromFaucetV2({
        host: faucet,
        recipient: native.device.address,
      });
      const deviceManager = new SelfPayTransactionManager({
        client: creation.client,
        network: "localnet",
        signer: native,
        journal: new MemoryTransactionJournal(),
      });
      const futureQuote = await deviceManager.prepare({
        requestId: `future:${target}`,
        gasBudget: 200_000_000n,
        transaction: creation.sdk.productRecord.save({
          organizationId,
          humanId: stableHuman,
          grantId: grant.id,
          kind: "okr",
          logicalId: bodyHeader.logicalId,
          expectedRevision: 0,
          keyVersion: 2,
          encryptedBody: fromBase64(futureCipher),
        }),
      });
      const saved = await deviceManager.submit(futureQuote);
      assert.equal(saved.status, "confirmed");
      transactions.push({
        action: "new device writes version-2 body after recovery",
        digest: saved.digest,
        actualGas: saved.actualGas,
      });
      newBody.fill(0);
      checks.push(
        "old native content ring cannot decrypt version-2 writes; chain accepts the recovered device's new-key body",
      );
    } else {
      const futurePlain = await bodies.read(
        (
          await wait(
            () => bodies.list(),
            (rows) => rows.some((r) => r.logicalId === "post-recovery-body"),
          )
        ).find((r) => r.logicalId === "post-recovery-body")!,
      );
      assert.equal(
        new TextDecoder().decode(futurePlain),
        "Future body protected by new organization key",
      );
      futurePlain.fill(0);
      checks.push(
        "a second native recovery retains version-1 and version-2 history and installs version-3 keys",
      );
    }
    currentCode = prepared.recoveryCode;
    sourceRecoveryAddress = reload.nextRecovery.address;
    oldDevice = native;
    oldGrant = grant.id;
    scoped.organizations[organizationId].contentKey = "";
    scoped.organizations[organizationId].historicalKeys = {};
    publicRecovered = {
      humanId: stableHuman,
      device: native.device,
      grantId: grant.id,
      recoveryAddress: current.recovery_address,
      generation: current.generation,
      recoveryVersion: current.recovery_version,
    };
  }
  // A code-derived public lookup reconstructs the identity without Human ID input
  // or a transaction cache. The fixture uses native import, not JS private signing.
  const importedLast = request("importRecovery", {
    profile: recoveryProfiles[2],
    network: "localnet",
    code: currentCode,
  });
  const located = await creation.client.core.getDynamicField({
    parentId: registry.recoveries.id,
    name: {
      type: "address",
      bcs: bcs.Address.serialize(importedLast.recovery.address).toBytes(),
    },
  });
  assert.equal(
    RecoveryLocationBcs.parse(located.dynamicField.value.bcs).human_id,
    stableHuman,
  );
  checks.push(
    "only the new code plus public network/deployment metadata locates the same stable Human from a fresh native profile",
  );
  currentCode = "";
  keyring.contentKey = "";
  keyring.historicalKeys = {};
  expected.fill(0);
  const report = {
    format: 1,
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    chain: { rpc, chainIdentifier: profileData.chainIdentifier },
    profile,
    humanId: stableHuman,
    organizationId,
    publicRecovered,
    checks,
    transactions,
    limits: {
      nativeTransport:
        "isolated subprocess helper, not installed App recovery IPC/UI",
      controller:
        "test adapter; production recovery source validation/quotes/unknown-outcome controller and UI remain pending",
      journal: "in-memory fixture; installed UI durable journal not exercised",
      rawCodeInReport: false,
      fullV020Complete: false,
    },
  };
  await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      passed: checks.length,
      transactions: transactions.length,
      report: process.argv[3],
    }),
  );
} finally {
  // Also clean entries from partial initialization; cleanup is never conditional
  // on receiving a successful return from the key-store mutation.
  for (const target of [profile, ...recoveryProfiles])
    request("remove", { profile: target });
}
