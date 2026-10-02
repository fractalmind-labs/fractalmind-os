/** Generated, isolated credentials only. Uses the production NativeRecoverySigner
 * and IdentityCreation; no JS private signer is used to submit either transaction. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { PrivateRecords } from "../src/private-records";
import { ChainReadSession } from "../src/chain";
import { DeviceIdentityVerifier } from "../src/device-identity";
import { NativeImportedRecoverySigner } from "../src/native-recovery";
import { IdentityRecovery } from "../src/recovery";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  recoveryKeys,
  unwrapKeys,
  MemoryTransactionJournal,
  TransactionPreflightError,
  SelfPayTransactionManager,
  RecoveryLocationBcs,
  type SelfPayTransactionOutcome,
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
  async function effectsVisible(outcome: SelfPayTransactionOutcome) {
    assert.ok(outcome.transaction?.effects);
    for (const changed of outcome.transaction.effects.changedObjects) {
      if (changed.outputState !== "ObjectWrite" || !changed.outputVersion)
        continue;
      await wait(
        () =>
          creation.client.core
            .getObject({ objectId: changed.objectId })
            .catch((error) => {
              if (
                error?.reason === "notFound" &&
                error.objectId === changed.objectId
              )
                return null;
              throw error;
            }),
        (value) =>
          !!value &&
          BigInt(value.object.version) >= BigInt(changed.outputVersion!),
      );
    }
  }
  await effectsVisible(humanResult);
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
  await effectsVisible(orgResult);
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
  await effectsVisible(historical);
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
      if (command === "fm_recovery_import")
        return request("importRecovery", {
          profile: target,
          network: args.network,
          code: args.code,
        });
      if (command === "fm_recovery_imported_public")
        return request("publicImportedRecovery", {
          profile: target,
          network: args.network,
        });
      if (command === "fm_recovery_prepare")
        return request("prepareRecovery", {
          profile: target,
          network: args.network,
          source: args.source,
        });
      if (command === "fm_recovery_prepared_public")
        return request("publicPreparedRecovery", {
          profile: target,
          network: args.network,
        });
      if (command === "fm_recovery_sign_transaction")
        return request("signRecovery", {
          profile: target,
          network: args.network,
          phase: args.phase,
          bytes: args.bytes,
        });
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
  let currentCode = result.recoveryCode;
  let oldDevice = device,
    oldGrant = noCache!.grantId;
  let sourceRecoveryAddress = recovery.material.recovery.address;
  let publicRecovered: unknown;
  for (let round = 0; round < 2; round++) {
    const target = recoveryProfiles[round],
      transport = deviceInvoke(target);
    await assert.rejects(
      NativeImportedRecoverySigner.load(transport, target, "localnet"),
      /not_initialized/,
    );
    await assert.rejects(
      NativeImportedRecoverySigner.import(
        transport,
        target,
        "mainnet",
        currentCode,
      ),
      /invalid_recovery/,
    );
    assert.throws(
      () => request("public", { profile: target }),
      /NotInitialized/,
    );
    const recoverySigner = await NativeImportedRecoverySigner.import(
      transport,
      target,
      "localnet",
      currentCode,
    );
    const native = await NativeDeviceSigner.load(transport, target);
    assert.equal(
      recoverySigner.material.recovery.address,
      sourceRecoveryAddress,
    );
    assert.notEqual(native.device.address, oldDevice.device.address);
    await assert.rejects(
      NativeImportedRecoverySigner.import(
        transport,
        target,
        "localnet",
        currentCode,
      ),
      /already_initialized/,
    );
    assert.throws(
      () =>
        request("createOnboarding", { profile: target, network: "localnet" }),
      /AlreadyInitialized/,
    );
    const journal = new MemoryTransactionJournal();
    const controller = new IdentityRecovery(
      profileData,
      recoverySigner,
      native,
      journal,
    );
    const ready = await controller.inspect();
    assert.equal(ready.phase, "ready");
    assert.equal(ready.humanId, stableHuman);
    assert.equal(ready.organizations[0].owned, true);
    await assert.rejects(controller.prepare(false), /backup_not_confirmed/);
    const oldHuman = await creation.sdk.identity.getHuman(stableHuman);
    const oldRecord = await creation.sdk.identity.getRecoveryRecord(
      oldHuman.recovery_record,
    );
    const prepared = await controller.prepareReplacement();
    const reload = await NativeImportedRecoverySigner.load(
      transport,
      target,
      "localnet",
    );
    const stage = (await reload.loadStage())!;
    assert.deepEqual(stage.nextRecovery, prepared.stage.nextRecovery);
    assert.equal(stage.sourceFingerprint, prepared.stage.sourceFingerprint);
    assert.notEqual(stage.encryptedBackup, prepared.stage.encryptedBackup);
    assert.equal("recoveryCode" in stage, false);
    assert.equal((await controller.prepareReplacement()).recoveryCode, "");
    assert.deepEqual(stage.rotations, [
      {
        organizationId,
        oldVersion: String(round + 1),
        newVersion: String(round + 2),
      },
    ]);
    const independentNext = recoveryKeys(prepared.recoveryCode, "localnet");
    assert.equal(independentNext.address, stage.nextRecovery.address);
    const backup = await unwrapKeys(
      fromBase64(stage.encryptedBackup),
      independentNext.encryptionSecret,
      `fractalmind.recovery-backup.v1:localnet:${stage.nextRecovery.address}`,
    );
    const scoped = JSON.parse(new TextDecoder().decode(backup));
    backup.fill(0);
    independentNext.encryptionSecret.fill(0);
    assert.equal(
      scoped.organizations[organizationId].currentVersion,
      String(round + 2),
    );
    assert.equal(
      scoped.organizations[organizationId].historicalKeys["1"],
      keyring.contentKey,
    );
    checks.push(
      `recovery ${round + 1}: production native bridge imports/reloads independent credentials; verified chain lookup and fingerprint prepare a one-shot replacement without quoting/submitting`,
    );
    if (round === 1) {
      await assert.rejects(
        controller.prepare(true),
        (e) =>
          e instanceof TransactionPreflightError && e.code === "needs_funds",
      );
      await requestSuiFromFaucetV2({
        host: faucet,
        recipient: recoverySigner.material.recovery.address,
      });
      checks.push(
        "zero recovery address balance blocks quotation until explicit isolated fixture funding",
      );
    }
    let quote = await controller.prepare(true);
    assert.ok(!("status" in quote));
    assert.equal(await controller.query(), undefined);
    if (round === 0) {
      const changeQuote = await creation.deviceManager.prepare({
        requestId: `recovery-change:${target}`,
        gasBudget: 200_000_000n,
        transaction: creation.sdk.identity.updateOrganizationDescription({
          humanId: stableHuman,
          grantId: noCache!.grantId,
          organizationId,
          description: "Changed after recovery quote",
        }),
      });
      const changed = await creation.deviceManager.submit(changeQuote);
      assert.equal(changed.status, "confirmed");
      await effectsVisible(changed);
      transactions.push({
        action: "change organization after recovery quotation",
        digest: changed.digest,
        actualGas: changed.actualGas,
      });
      await assert.rejects(controller.submit(quote, true), /source_changed/);
      assert.equal(await controller.query(), undefined);
      quote = await controller.prepare(true);
      assert.ok(!("status" in quote));
      checks.push(
        "actual organization change invalidates the old recovery quote before native signing or broadcasting; an explicit fresh quote can proceed",
      );
    }
    let recovered;
    if (round === 0) {
      const originalExecute = controller.client.core.executeTransaction.bind(
        controller.client.core,
      );
      let broadcasts = 0;
      controller.client.core.executeTransaction = async (input) => {
        broadcasts++;
        await originalExecute(input);
        throw new Error("Isolated recovery response dropped after broadcast");
      };
      const ambiguous = await controller.submit(quote, true);
      assert.equal(ambiguous.status, "unknown");
      controller.client.core.executeTransaction = originalExecute;
      recovered = await wait(
        () => controller.query(),
        (value) => value?.status === "confirmed",
      );
      assert.equal(recovered!.digest, ambiguous.digest);
      assert.equal(broadcasts, 1);
      assert.equal(
        ((await controller.prepare(true)) as { digest: string }).digest,
        ambiguous.digest,
      );
      checks.push(
        "actual recovery response loss stays unknown; only the same digest is queried, no second recovery broadcast or replacement code generation",
      );
    } else recovered = await controller.submit(quote, true);
    assert.ok(recovered);

    assert.equal(recovered.status, "confirmed");
    await effectsVisible(recovered);
    transactions.push({
      action: `production native/controller atomic organization rotation and recovery ${round + 1}`,
      digest: recovered.digest,
      actualGas: recovered.actualGas,
    });
    const rebuilt = new IdentityRecovery(
      profileData,
      await NativeImportedRecoverySigner.load(transport, target, "localnet"),
      native,
      journal,
    );
    assert.equal((await rebuilt.query())!.digest, recovered.digest);
    assert.equal(
      ((await rebuilt.prepare(true)) as { digest: string }).digest,
      recovered.digest,
    );
    const restored = await rebuilt.awaitRecovered();
    assert.equal(restored.humanId, stableHuman);
    assert.equal(restored.phase, "recovered");
    const noJournal = new IdentityRecovery(
      profileData,
      await NativeImportedRecoverySigner.load(transport, target, "localnet"),
      native,
      new MemoryTransactionJournal(),
    );
    assert.equal((await noJournal.inspect()).phase, "recovered");
    await assert.rejects(noJournal.prepareReplacement(), /code_consumed/);
    checks.push(
      `recovery ${round + 1}: production recovery reconstructs the exact new device from chain/OS and queries the original digest; an empty journal cannot replay consumed recovery`,
    );
    const current = await creation.sdk.identity.getHuman(stableHuman);
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
      recoverySigningKey: fromBase64(stage.nextRecovery.signingPublicKey),
      recoveryEncryptionKey: fromBase64(stage.nextRecovery.encryptionPublicKey),
      encryptedBackup: fromBase64(stage.encryptedBackup),
      device: native.device.address,
      deviceEncryptionKey: fromBase64(native.device.encryptionPublicKey),
      encryptedDeviceKeys: fromBase64(stage.encryptedDeviceKeys),
    });
    await assert.rejects(
      controller.manager.prepare({
        requestId: `replay:${target}`,
        transaction: replay,
        gasBudget: 200_000_000n,
      }),
    );
    const chain = new ChainReadSession(restored.profile);
    await assert.rejects(
      new DeviceIdentityVerifier(chain, oldDevice, oldGrant).verify(),
    );
    await new DeviceIdentityVerifier(
      chain,
      native,
      restored.grantId!,
    ).verifyOrganization(organizationId, "approve");
    const bodies = new PrivateRecords(
      chain,
      native,
      restored.grantId!,
      organizationId,
      transport,
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
      `recovery ${round + 1}: stable Human/org IDs, consumed code and invalidated prior device are proven on chain; historical v1 body decrypts on the authorized recovered device`,
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
      const grant = await creation.sdk.identity.getDeviceGrant(
        restored.grantId!,
      );
      const cipher = request("encryptRecord", {
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
              encryptedBody: cipher,
            }),
          }),
        /InvalidEnvelope/,
      );
      await requestSuiFromFaucetV2({
        host: faucet,
        recipient: native.device.address,
      });
      const writer = new SelfPayTransactionManager({
        client: creation.client,
        network: "localnet",
        signer: native,
        journal: new MemoryTransactionJournal(),
      });
      const writeQuote = await writer.prepare({
        requestId: `future:${target}`,
        gasBudget: 200_000_000n,
        transaction: creation.sdk.productRecord.save({
          organizationId,
          humanId: stableHuman,
          grantId: restored.grantId!,
          kind: "okr",
          logicalId: bodyHeader.logicalId,
          expectedRevision: 0,
          keyVersion: 2,
          encryptedBody: fromBase64(cipher),
        }),
      });
      const saved = await writer.submit(writeQuote);
      assert.equal(saved.status, "confirmed");
      await effectsVisible(saved);
      transactions.push({
        action: "recovered device saves version-2 body",
        digest: saved.digest,
        actualGas: saved.actualGas,
      });
      newBody.fill(0);
      checks.push(
        "old native content keys cannot decrypt new version-2 writes accepted on chain",
      );
    } else {
      const futureRows = await wait(
        () => bodies.list(),
        (rows) => rows.some((r) => r.logicalId === "post-recovery-body"),
      );
      const plain = await bodies.read(
        futureRows.find((r) => r.logicalId === "post-recovery-body")!,
      );
      assert.equal(
        new TextDecoder().decode(plain),
        "Future body protected by new organization key",
      );
      plain.fill(0);
      checks.push(
        "a second controller/native recovery preserves v1/v2 chain bodies and prepares v3 keys",
      );
    }
    currentCode = prepared.recoveryCode;
    sourceRecoveryAddress = stage.nextRecovery.address;
    oldDevice = native;
    oldGrant = restored.grantId!;
    scoped.organizations[organizationId].contentKey = "";
    scoped.organizations[organizationId].historicalKeys = {};
    publicRecovered = {
      humanId: stableHuman,
      device: native.device,
      grantId: restored.grantId!,
      recoveryAddress: current.recovery_address,
      generation: current.generation,
      recoveryVersion: current.recovery_version,
    };
  }
  let beforeRecoverySign: (() => Promise<void>) | null = null;
  const freshTransport: NativeInvoke = async (command, args) => {
    if (command === "fm_recovery_sign_transaction" && beforeRecoverySign) {
      const hook = beforeRecoverySign;
      beforeRecoverySign = null;
      await hook();
    }
    return deviceInvoke(recoveryProfiles[2])(command, args);
  };
  const fresh = await NativeImportedRecoverySigner.import(
    freshTransport,
    recoveryProfiles[2],
    "localnet",
    currentCode,
  );
  const freshDevice = await NativeDeviceSigner.load(
    freshTransport,
    recoveryProfiles[2],
  );
  const freshController = new IdentityRecovery(
    profileData,
    fresh,
    freshDevice,
    new MemoryTransactionJournal(),
  );
  assert.equal((await freshController.inspect()).humanId, stableHuman);
  checks.push(
    "only the new code and public deployment metadata locate the same stable Human through the production recovery controller without an input Human ID",
  );
  await freshController.prepareReplacement();
  for (const recipient of [
    fresh.material.recovery.address,
    oldDevice.device.address,
  ])
    await requestSuiFromFaucetV2({ host: faucet, recipient });
  const lateQuote = await freshController.prepare(true);
  assert.ok(!("status" in lateQuote));
  const currentHuman = await creation.sdk.identity.getHuman(stableHuman),
    currentRecord = await creation.sdk.identity.getRecoveryRecord(
      currentHuman.recovery_record,
    );
  beforeRecoverySign = async () => {
    const updater = new SelfPayTransactionManager({
      client: creation.client,
      network: "localnet",
      signer: oldDevice,
      journal: new MemoryTransactionJournal(),
    });
    const updateQuote = await updater.prepare({
      requestId: `late-backup:${profile}`,
      gasBudget: 200_000_000n,
      transaction: creation.sdk.identity.updateRecoveryBackup({
        humanId: stableHuman,
        grantId: oldGrant,
        recordId: currentRecord.id,
        expectedBackupVersion: currentRecord.backup_version,
        encryptedBackup: Uint8Array.from(currentRecord.encrypted_backup),
      }),
    });
    const update = await updater.submit(updateQuote);
    assert.equal(update.status, "confirmed");
    await effectsVisible(update);
    transactions.push({
      action:
        "replace backup after source checks but before native recovery signature",
      digest: update.digest,
      actualGas: update.actualGas,
    });
  };
  const conflict = await freshController.submit(lateQuote, true);
  assert.equal(conflict.status, "failed");
  assert.equal(conflict.transaction!.status.success, false);
  const failure = conflict.transaction!.status.error;
  assert.equal(failure?.$kind, "MoveAbort");
  if (failure?.$kind !== "MoveAbort")
    throw new Error("Expected snapshot abort");
  assert.equal(failure.MoveAbort.abortCode, "9006");
  assert.equal(failure.MoveAbort.location?.module, "identity");
  assert.equal(
    failure.MoveAbort.location?.functionName,
    "assert_recovery_snapshot",
  );
  await effectsVisible(conflict);
  assert.ok(conflict.actualGas);
  transactions.push({
    action:
      "on-chain recovery snapshot guard rejects stale signed recovery atomically",
    digest: conflict.digest,
    actualGas: conflict.actualGas,
    status: "expected failure",
    failure,
  });
  const unchanged = await creation.sdk.identity.getHuman(stableHuman);
  assert.equal(unchanged.generation, currentHuman.generation);
  assert.equal(unchanged.recovery_record, currentRecord.id);
  assert.equal(
    (await creation.sdk.identity.getRecoveryRecord(currentRecord.id)).active,
    true,
  );
  assert.equal(
    (await creation.sdk.productRecord.listCurrent(organizationId, null, 1))
      .keyVersion,
    "3",
  );
  assert.equal((await freshController.query())!.digest, conflict.digest);
  assert.equal(
    ((await freshController.prepare(true)) as { digest: string }).digest,
    conflict.digest,
  );
  checks.push(
    "backup update during native signing fails at the contract snapshot guard: Human/recovery/grants/key version remain unchanged and actual failed Gas is retained without replay",
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
    deployment: {
      packageId: profileData.packageId,
      registryId: profileData.registryId,
    },
    publicRecovered,
    checks,
    transactions,
    limits: {
      nativeTransport:
        "isolated subprocess transport of production bridge commands, not installed UI IPC",
      controller: "production native bridge and recovery controller",
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
  for (const target of [profile, ...recoveryProfiles])
    request("remove", { profile: target });
}
