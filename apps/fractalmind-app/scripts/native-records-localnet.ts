/** Generated, isolated credentials only. Uses the production NativeRecoverySigner
 * and IdentityCreation; no JS private signer is used to submit either transaction. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  recoveryKeys,
  unwrapKeys,
  MemoryTransactionJournal,
  TransactionPreflightError,
  encryptContent,
  encryptCommandResult,
  commandResultKey,
  recordContext,
  wrapKeys,
  SelfPayTransactionManager,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { PrivateRecords } from "../src/private-records";
import { ChainReadSession } from "../src/chain";
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
    case "fm_device_decrypt_record":
      return request("decryptRecord", { record: args.record });
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
let created = false;
try {
  await assert.rejects(
    NativeRecoverySigner.load(invoke, profile, "localnet"),
    /not_initialized/,
  );
  checks.push("loading an absent onboarding profile does not create keys");
  const result = await NativeRecoverySigner.create(invoke, profile, "localnet");
  created = true;
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
  const key = Uint8Array.from(
    keyring.contentKey.match(/../g).map((v: string) => parseInt(v, 16)),
  );
  // Test-only interoperability key from the intentional recovery backup export.
  // The production PrivateRecords controller neither receives nor exports it.
  const api = new PrivateRecords(
    new ChainReadSession(noCache!.profile),
    device,
    noCache!.grantId,
    organizationId,
    invoke,
  );
  const logicalId = 'okr-native-正文-"quoted"';
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      objective: "Native encrypted goal",
      constraints: ["write only inside assigned directory"],
    }),
  );
  const envelope = await encryptContent(
    plaintext,
    key,
    recordContext(organizationId, "okr", logicalId, 1, 1),
  );
  const input = {
    network: "localnet",
    encryptedKeys: recovery.material.encryptedDeviceKeys,
    organizationId,
    kind: 1,
    logicalId,
    revision: "1",
    keyVersion: "1",
    encryptedBody: toBase64(envelope),
  };
  assert.deepEqual(
    fromBase64(request("decryptRecord", { record: JSON.stringify(input) })),
    plaintext,
  );
  const mutated = {
    ...input,
    encryptedBody: toBase64(
      Uint8Array.from(envelope, (v, i) =>
        i === envelope.length - 1 ? v ^ 1 : v,
      ),
    ),
  };
  for (const changed of [
    mutated,
    { ...input, network: "mainnet" },
    { ...input, revision: "2" },
    { ...input, organizationId: "0x" + "1".repeat(64) },
    { ...input, logicalId: "other" },
    { ...input, keyVersion: "2" },
    { ...input, revision: "01" },
  ])
    assert.throws(
      () => request("decryptRecord", { record: JSON.stringify(changed) }),
      /InvalidEnvelope/,
    );
  checks.push(
    "independent JS FME1/UTF-8/quoted contexts decrypt natively; tamper, wrong network/org/logical id/revision/key version and noncanonical versions fail",
  );
  const writeQuote = await creation.deviceManager.prepare({
    requestId: "record-okr:" + profile,
    gasBudget: 200_000_000n,
    transaction: creation.sdk.productRecord.save({
      organizationId,
      humanId: noCache!.profile.humanId,
      grantId: noCache!.grantId,
      kind: "okr",
      logicalId,
      expectedRevision: 0,
      keyVersion: 1,
      encryptedBody: envelope,
    }),
  });
  const saved = await creation.deviceManager.submit(writeQuote);
  assert.equal(saved.status, "confirmed");
  transactions.push({
    action: "save independently encrypted OKR body with native device signer",
    digest: saved.digest,
    actualGas: saved.actualGas,
  });
  // Wait for this transaction's directory indexing, never replay the write.
  async function recordsVisible(count: number) {
    const until = Date.now() + 15000;
    while (true) {
      try {
        const rows = await api.list();
        if (rows.length === count) return rows;
      } catch {}
      if (Date.now() >= until) throw new Error("Record index not visible");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const rows = await recordsVisible(1);
  const read = await api.read(rows[0]);
  assert.deepEqual(read, plaintext);
  read.fill(0);
  checks.push(
    "production controller reads actual immutable chain body, unwraps on-chain device keyring natively, and verifies role/grant before and after read",
  );
  const hash = "a".repeat(64),
    commandId = "command-" + hash;
  const derived = commandResultKey(key, organizationId, hash, 1);
  const commandPlain = new TextEncoder().encode(
    '{"exitCode":0,"result":"verified fixture"}',
  );
  const commandEnvelope = await encryptCommandResult(
    commandPlain,
    derived,
    recordContext(organizationId, "checkpoint", commandId, 1, 1),
  );
  derived.fill(0);
  const commandQuote = await creation.deviceManager.prepare({
    requestId: "record-command:" + profile,
    gasBudget: 200_000_000n,
    transaction: creation.sdk.productRecord.save({
      organizationId,
      humanId: noCache!.profile.humanId,
      grantId: noCache!.grantId,
      kind: "checkpoint",
      logicalId: commandId,
      expectedRevision: 0,
      keyVersion: 1,
      encryptedBody: commandEnvelope,
    }),
  });
  const commandSaved = await creation.deviceManager.submit(commandQuote);
  assert.equal(commandSaved.status, "confirmed");
  transactions.push({
    action: "save command-derived FME2 result with native device signer",
    digest: commandSaved.digest,
    actualGas: commandSaved.actualGas,
  });
  const commandRow = (await recordsVisible(2)).find(
    (r) => r.logicalId === commandId,
  )!;
  const commandRead = await api.read(commandRow);
  assert.deepEqual(commandRead, commandPlain);
  commandRead.fill(0);
  assert.throws(
    () =>
      request("decryptRecord", {
        record: JSON.stringify({
          ...input,
          encryptedBody: toBase64(commandEnvelope),
        }),
      }),
    /InvalidEnvelope/,
  );
  checks.push(
    "independently derived FME2 command results interoperate with native HKDF and reject substitution as an OKR",
  );
  const restoredRecords = new PrivateRecords(
    new ChainReadSession(noCache!.profile),
    await NativeDeviceSigner.load(invoke, profile),
    noCache!.grantId,
    organizationId,
    invoke,
  );
  const restoredPlain = await restoredRecords.read(
    (await restoredRecords.list()).find((r) => r.logicalId === logicalId)!,
  );
  assert.deepEqual(restoredPlain, plaintext);
  restoredPlain.fill(0);
  checks.push(
    "a rebuilt controller and fresh native process reconstruct/decrypt current bodies from chain without a plaintext/key cache",
  );
  // Move cannot borrow the same Grant as both immutable authorizer and mutable
  // revocation target. Prepare a second independently held root device.
  const secondProfile = profile + "-r";
  const secondInvoke: NativeInvoke = async (command, args) => {
    assert.equal(args.profile, secondProfile);
    if (command === "fm_device_initialize")
      return request("initialize", { profile: secondProfile });
    if (command === "fm_device_public")
      return request("public", { profile: secondProfile });
    if (command === "fm_device_sign_transaction")
      return request("signTransaction", {
        profile: secondProfile,
        bytes: args.bytes,
      });
    throw new Error("Unexpected second-device operation");
  };
  const second = await NativeDeviceSigner.initialize(
    secondInvoke,
    secondProfile,
  );
  const ringBytes = new TextEncoder().encode(JSON.stringify(keyring));
  const secondWrapped = await wrapKeys(
    ringBytes,
    fromBase64(second.device.encryptionPublicKey),
    `fractalmind.device-keys.v1:localnet:${second.device.address}`,
  );
  ringBytes.fill(0);
  const addQuote = await creation.deviceManager.prepare({
    requestId: "record-add:" + profile,
    gasBudget: 200_000_000n,
    transaction: creation.sdk.identity.addRootDevice({
      identityRegistryId: await creation.sdk.identity.resolveRegistry(),
      humanId: noCache!.profile.humanId,
      grantId: noCache!.grantId,
      device: second.device.address,
      deviceEncryptionKey: fromBase64(second.device.encryptionPublicKey),
      encryptedDeviceKeys: secondWrapped,
      expiresAtMs: Date.now() + 3600_000,
    }),
  });
  const added = await creation.deviceManager.submit(addQuote);
  assert.equal(added.status, "confirmed");
  transactions.push({
    action: "authorize independent native revocation device",
    digest: added.digest,
    actualGas: added.actualGas,
  });
  let secondGrant;
  const grantUntil = Date.now() + 15000;
  while (!secondGrant) {
    const grants = await new ChainReadSession(noCache!.profile).human();
    secondGrant = grants.grants.value?.find(
      (g) => g.device === second.device.address,
    );
    if (!secondGrant) {
      if (Date.now() >= grantUntil) throw new Error("Second Grant not indexed");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await requestSuiFromFaucetV2({
    host: faucet,
    recipient: second.device.address,
  });
  const revoker = new SelfPayTransactionManager({
    client: creation.client,
    network: "localnet",
    signer: second,
    journal: new MemoryTransactionJournal(),
  });
  const revokeQuote = await revoker.prepare({
    requestId: "record-revoke:" + profile,
    gasBudget: 200_000_000n,
    transaction: creation.sdk.identity.revokeDevice({
      humanId: noCache!.profile.humanId,
      grantId: secondGrant.id,
      targetGrantId: noCache!.grantId,
    }),
  });
  const revoked = await revoker.submit(revokeQuote);
  assert.equal(revoked.status, "confirmed");
  transactions.push({
    action: "revoke native device grant",
    digest: revoked.digest,
    actualGas: revoked.actualGas,
  });
  const until = Date.now() + 15000;
  while (
    !(await creation.sdk.identity.getDeviceGrant(noCache!.grantId)).revoked
  ) {
    if (Date.now() >= until) throw new Error("Revocation not visible");
    await new Promise((r) => setTimeout(r, 100));
  }
  await assert.rejects(api.read(rows[0]));
  await assert.rejects(api.list());
  checks.push(
    "actual chain revocation blocks future controller listing and decrypt, even with unchanged native credentials",
  );
  key.fill(0);
  keyring.contentKey = "";
  keyring.historicalKeys = {};
  plaintext.fill(0);
  commandPlain.fill(0);
  const report = {
    format: 1,
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    chain: { rpc, chainIdentifier: profileData.chainIdentifier },
    profile,
    publicDevice: device.device,
    recoveryAddress: recovery.material.recovery.address,
    humanId: found.profile.humanId,
    organizationId: noCache!.organizations[0].objectId,
    checks,
    transactions,
    limits: {
      nativeTransport:
        "isolated subprocess test transport, not installed UI IPC",
      journal:
        "in-memory fixture; installed UI uses IndexedDbTransactionJournal",
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
  if (created) {
    try {
      request("remove");
    } finally {
      request("remove", { profile: profile + "-r" });
    }
  }
}
