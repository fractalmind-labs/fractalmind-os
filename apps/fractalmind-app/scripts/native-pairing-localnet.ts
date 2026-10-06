/** Generated, isolated credentials only. Uses the production NativeRecoverySigner
 * and IdentityCreation; no JS private signer is used to submit either transaction. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, open, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { PrivateRecords } from "../src/private-records";
import { ChainReadSession } from "../src/chain";
import { DeviceIdentityVerifier } from "../src/device-identity";
import { DevicePairing } from "../src/pairing";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  recoveryKeys,
  unwrapKeys,
  MemoryTransactionJournal,
  TransactionPreflightError,
  SelfPayTransactionManager,
  type SelfPayTransactionOutcome,
  type TransactionJournalEntry,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { NativeRecoverySigner } from "../src/native-onboarding";
import { IdentityCreation, normalizeDeployment } from "../src/onboarding";
assert.ok(
  process.argv[2] && process.argv[3],
  "Pass deployment and output reports",
);
const deployment = JSON.parse(await readFile(process.argv[2], "utf8"));
const output = process.argv[3],
  progress = output + ".progress.json";
for (const path of [output, progress]) {
  try {
    await access(path);
    throw new Error("Inspect the original report; do not overwrite or restart");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
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
const journalEvents: { journal: number; entry: TransactionJournalEntry }[] = [];
const state: Record<string, unknown> = { phase: "starting" };
let journalCount = 0,
  complete = false;
async function save(final = false) {
  const report = {
    format: 2,
    recordedAt: new Date().toISOString(),
    complete,
    platform: process.platform,
    profile,
    deployment: {
      packageId: deployment.packageId,
      originalPackageId: deployment.originalPackageId,
      okrPackageId: deployment.okrPackageId,
      originalOkrPackageId: deployment.originalOkrPackageId,
      directPackageId: deployment.directPackageId,
      originalDirectPackageId: deployment.originalDirectPackageId,
      registryId: deployment.registryId,
    },
    chain: { rpc, chainIdentifier: deployment.chain.chainIdentifier },
    checks,
    transactions,
    journalEvents,
    state,
    limits: {
      nativeTransport:
        "isolated production bridge subprocess; installed UI/IPC not exercised",
      journal:
        "independent in-memory fixtures with public pre-broadcast journal snapshots; not installed IndexedDB",
      fullV020Complete: false,
      privateKeysInReport: false,
      physicalSecondDeviceVerified: false,
    },
  };
  const content = JSON.stringify(report, null, 2) + "\n";
  if (final) {
    await writeFile(output, content, { flag: "wx", mode: 0o600 });
  } else {
    const temporary = progress + "." + randomUUID();
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, progress);
  }
}
/** Preserve original technical digests before the manager broadcasts. Each
 * instance is still a separate cache, including the intentionally empty ones. */
class EvidenceJournal extends MemoryTransactionJournal {
  private readonly journalId = ++journalCount;
  async claim(entry: TransactionJournalEntry) {
    const claimed = await super.claim(entry);
    if (claimed) {
      journalEvents.push({
        journal: this.journalId,
        entry: structuredClone(entry),
      });
      await save();
    }
    return claimed;
  }
  async replace(entry: TransactionJournalEntry, expectedRevision: number) {
    const replaced = await super.replace(entry, expectedRevision);
    if (replaced) {
      journalEvents.push({
        journal: this.journalId,
        entry: structuredClone(entry),
      });
      await save();
    }
    return replaced;
  }
}
async function check(message: string) {
  checks.push(message);
  await save();
}
async function record(value: unknown) {
  transactions.push(value);
  await save();
}
const recoveryProfiles = [profile + "-a", profile + "-b", profile + "-used"];
let runFailed = false,
  runError: unknown;
await writeFile(progress, "{}\n", { flag: "wx", mode: 0o600 });
try {
  await save();
  await assert.rejects(
    NativeRecoverySigner.load(invoke, profile, "localnet"),
    /not_initialized/,
  );
  await check("loading an absent onboarding profile does not create keys");
  const result = await NativeRecoverySigner.create(invoke, profile, "localnet");
  const recovery = result.signer,
    device = await NativeDeviceSigner.load(invoke, profile);
  // The one-shot code is an explicit backup credential. Independent JS derivation
  // is an interoperability test only, never the signer used by the controller.
  const independent = recoveryKeys(result.recoveryCode, "localnet");
  result.recoveryCode = "";
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
  await check(
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
  await check(
    "fresh-process reload reveals public keys/ciphertext only; re-creation and wrong network are rejected",
  );
  const journal = new EvidenceJournal();
  const profileData = normalizeDeployment({
    network: "localnet",
    rpcUrl: rpc,
    packageId: deployment.packageId,
    originalPackageId: deployment.originalPackageId,
    originalOkrPackageId: deployment.originalOkrPackageId,
    originalDirectPackageId: deployment.originalDirectPackageId,
    okrPackageId: deployment.okrPackageId,
    directPackageId: deployment.directPackageId,
    registryId: deployment.registryId,
    chainIdentifier: deployment.chain.chainIdentifier,
  });
  let creation = new IdentityCreation(profileData, recovery, device, journal);
  assert.equal(
    (await creation.client.core.getChainIdentifier()).chainIdentifier,
    profileData.chainIdentifier,
  );
  state.phase = "chain_verified";
  assert.equal(await creation.locate(), null);
  await assert.rejects(
    creation.prepareIdentity(),
    (e) => e instanceof TransactionPreflightError && e.code === "needs_funds",
  );
  await check(
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
  await record({
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
  await check(
    "native recovery signs a real self-paid Human transaction; independent device possession resolves stable Human",
  );
  const orgQuote = await creation.prepareOrganization(
    `Native-onboarding-${Date.now()}`,
  );
  assert.ok(!("status" in orgQuote));
  const orgResult = await creation.submitOrganization(orgQuote);
  assert.equal(orgResult.status, "confirmed");
  await record({
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
  await check(
    "new native processes and a rebuilt controller query original digests and reconstruct the same Human/organization without replay",
  );
  // Clear all technical journal data and reconstruct from chain directory + OS
  // credentials. Confirmed business state must not depend on the journal.
  creation = new IdentityCreation(
    profileData,
    reloaded,
    device,
    new EvidenceJournal(),
  );
  const noCache = await creation.locate();
  assert.equal(noCache!.profile.humanId, found.profile.humanId);
  assert.equal(noCache!.organizations.length, 1);
  await assert.rejects(creation.prepareIdentity(), /already exists/);
  await assert.rejects(
    creation.prepareOrganization("duplicate"),
    /already exists/,
  );
  await check(
    "discarding transaction caches reconstructs confirmed business state from chain and refuses duplicate creation",
  );
  const organizationId = noCache!.organizations[0].objectId;
  const stableHuman = noCache!.profile.humanId;
  Object.assign(state, { humanId: stableHuman, organizationId });
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
  await record({
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
      const extra = { profile: target };
      if (command === "fm_device_initialize")
        return request("initialize", extra);
      if (command === "fm_device_public") return request("public", extra);
      if (command === "fm_device_sign_transaction")
        return request("signTransaction", { ...extra, bytes: args.bytes });
      if (command === "fm_device_prove")
        return request("proveDevice", { ...extra, challenge: args.challenge });
      if (command === "fm_device_decrypt_record")
        return request("decryptRecord", { ...extra, record: args.record });
      if (command === "fm_device_wrap_organization_keys")
        return request("wrapOrganizationKeys", {
          ...extra,
          record: args.request,
        });
      throw new Error("Unsupported isolated device operation");
    };
  }
  const pairedProfile = recoveryProfiles[0];
  const pairedInvoke = deviceInvoke(pairedProfile);
  const paired = await NativeDeviceSigner.initialize(
    pairedInvoke,
    pairedProfile,
  );
  assert.notEqual(paired.device.address, device.device.address);
  const chainProfile = { ...profileData, humanId: stableHuman };
  const pairedJournal = new EvidenceJournal();
  const applicant = new DevicePairing(
    new ChainReadSession(chainProfile),
    paired,
    pairedJournal,
    pairedInvoke,
  );
  const ownerInvoke = deviceInvoke(profile);
  const manager = new DevicePairing(
    new ChainReadSession(chainProfile),
    device,
    new EvidenceJournal(),
    ownerInvoke,
  );
  await assert.rejects(
    applicant.prepareCreate(organizationId, "Phone", "ios"),
    (e) => e instanceof TransactionPreflightError && e.code === "needs_funds",
  );
  await requestSuiFromFaucetV2({
    host: faucet,
    recipient: paired.device.address,
  });
  const createQuote = await applicant.prepareCreate(
    organizationId,
    "Phone",
    "ios",
  );
  assert.ok(!("status" in createQuote));
  assert.equal(await applicant.query("create"), undefined);
  const created = await applicant.submit(createQuote);
  assert.equal(created.status, "confirmed");
  await effectsVisible(created);
  const requestId = await applicant.requestFromResult(created);
  state.requestId = requestId;
  await record({
    action: "native device publishes ten-minute pairing request",
    digest: created.digest,
    actualGas: created.actualGas,
  });
  const requestState = await applicant.inspect(requestId);
  assert.equal(requestState.request.status, 0);
  assert.equal(requestState.request.device, paired.device.address);
  assert.equal(requestState.request.grant_id, null);
  assert.equal(
    (await manager.inspect(requestId)).fingerprint,
    requestState.fingerprint,
  );
  await assert.rejects(applicant.verifyRequester(requestId));
  await check(
    "unapproved request does not authorize a device; both ends reconstruct the identical public fingerprint from chain",
  );
  await assert.rejects(
    manager.prepareApproval(requestId, noCache!.grantId, ["read"], 7, false),
    /confirmation_required/,
  );
  const approvalQuote = await manager.prepareApproval(
    requestId,
    noCache!.grantId,
    ["read"],
    7,
    true,
  );
  assert.ok(!("status" in approvalQuote));
  const originalExecute =
    manager.chain.sdk.client.client.core.executeTransaction.bind(
      manager.chain.sdk.client.client.core,
    );
  const originalQuery =
    manager.chain.sdk.client.client.core.getTransaction.bind(
      manager.chain.sdk.client.client.core,
    );
  let broadcasts = 0;
  manager.chain.sdk.client.client.core.executeTransaction = async (input) => {
    const saved = JSON.parse(await readFile(progress, "utf8"));
    assert.ok(
      saved.journalEvents.some(
        (event: { entry: TransactionJournalEntry }) =>
          event.entry.digest === approvalQuote.digest &&
          event.entry.status === "pending",
      ),
      "original pending digest must be saved before broadcast",
    );
    broadcasts++;
    await originalExecute(input);
    throw new Error("Isolated approval receipt lost");
  };
  manager.chain.sdk.client.client.core.getTransaction = async () => {
    throw new Error("Isolated original receipt temporarily unavailable");
  };
  let ambiguous: SelfPayTransactionOutcome;
  try {
    ambiguous = await manager.submit(approvalQuote);
  } finally {
    manager.chain.sdk.client.client.core.executeTransaction = originalExecute;
    manager.chain.sdk.client.client.core.getTransaction = originalQuery;
  }
  state.approvalBroadcasts = broadcasts;
  state.ambiguousApprovalDigest = ambiguous.digest;
  await save();
  assert.equal(ambiguous.status, "unknown");
  const approval = await wait(
    () => manager.query("approve", requestId),
    (value) => value?.status === "confirmed",
  );
  assert.ok(approval);
  await effectsVisible(approval);
  assert.equal(approval.digest, ambiguous.digest);
  assert.equal(broadcasts, 1);
  await record({
    action:
      "scoped read-only pairing approval; lost receipt resolved by original digest",
    digest: approval.digest,
    actualGas: approval.actualGas,
  });
  const authorized = await applicant.verifyRequester(requestId);
  state.publicPair = {
    device: paired.device,
    grantId: authorized.grantId,
    fingerprint: requestState.fingerprint,
  };
  assert.equal(authorized.profile.humanId, stableHuman);
  assert.equal(authorized.data, "pending");
  const postApproval = await manager.inspect(requestId);
  assert.equal(postApproval.grant!.org_scope, organizationId);
  assert.deepEqual(postApproval.grant!.actions, [1]);
  assert.deepEqual(postApproval.grant!.encrypted_keys, []);
  const beforeData = new PrivateRecords(
    new ChainReadSession(chainProfile),
    paired,
    authorized.grantId,
    organizationId,
    pairedInvoke,
  );
  const heads = await beforeData.list();
  await assert.rejects(
    beforeData.read(heads.find((r) => r.logicalId === recordInput.logicalId)!),
  );
  await assert.rejects(
    new DeviceIdentityVerifier(
      new ChainReadSession(chainProfile),
      paired,
      authorized.grantId,
    ).verifyOrganization(organizationId, "approve"),
  );
  await check(
    "approval preserves the same Human with independent organization-scoped read permission, no identity-management/approval permission and no decryptable data keys",
  );
  const restarted = new DevicePairing(
    new ChainReadSession(chainProfile),
    device,
    new EvidenceJournal(),
    ownerInvoke,
  );
  await assert.rejects(
    restarted.prepareApproval(requestId, noCache!.grantId, ["read"], 7, true),
    /not_pending/,
  );
  assert.equal(
    (
      (await manager.prepareApproval(
        requestId,
        noCache!.grantId,
        ["read"],
        7,
        true,
      )) as { digest: string }
    ).digest,
    approval.digest,
  );
  await check(
    "consumed pairing cannot issue a second grant; persisted original outcome is returned instead of replaying approval",
  );
  await assert.rejects(
    manager.prepareDataSharing(requestId, noCache!.grantId, false),
    /confirmation_required/,
  );
  const dataQuote = await manager.prepareDataSharing(
    requestId,
    noCache!.grantId,
    true,
  );
  assert.ok(!("status" in dataQuote));
  const shared = await manager.submit(dataQuote);
  assert.equal(shared.status, "confirmed");
  await effectsVisible(shared);
  await record({
    action:
      "separate native selected-organization data wrapping and key-envelope publication",
    digest: shared.digest,
    actualGas: shared.actualGas,
  });
  const afterData = await applicant.verifyRequester(requestId);
  assert.equal(afterData.data, "wrapped");
  const reloadedPair = await NativeDeviceSigner.load(
    pairedInvoke,
    pairedProfile,
  );
  const reader = new PrivateRecords(
    new ChainReadSession(chainProfile),
    reloadedPair,
    afterData.grantId,
    organizationId,
    pairedInvoke,
  );
  const readHeads = await reader.list();
  const plain = await reader.read(
    readHeads.find((r) => r.logicalId === recordInput.logicalId)!,
  );
  assert.deepEqual(plain, expected);
  plain.fill(0);
  await check(
    "explicit second transaction shares only the selected organization, reloaded independent native device authenticates/decrypts the real chain body; no JS content key used",
  );
  const clock = (await manager.chain.human()).clockMs;
  const permissionChange = await creation.deviceManager.submit(
    await creation.deviceManager.prepare({
      requestId: `pair-permissions:${profile}`,
      gasBudget: 200_000_000n,
      transaction: creation.sdk.identity.changeDevicePermissions({
        humanId: stableHuman,
        grantId: noCache!.grantId,
        targetGrantId: authorized.grantId,
        organizationId,
        actions: ["read", "approve"],
        expiresAtMs: clock + 7n * 86400000n,
      }),
    }),
  );
  assert.equal(permissionChange.status, "confirmed");
  await effectsVisible(permissionChange);
  await record({
    action:
      "explicitly change paired device to scoped approval without root identity rights",
    digest: permissionChange.digest,
    actualGas: permissionChange.actualGas,
  });
  await check(
    "paired permissions change only through an explicit owner-signed organization-scoped transaction",
  );
  let beforeShareSignature: (() => Promise<void>) | null = null;
  const guardedInvoke: NativeInvoke = async (command, args) => {
    if (command === "fm_device_sign_transaction" && beforeShareSignature) {
      const hook = beforeShareSignature;
      beforeShareSignature = null;
      await hook();
    }
    return ownerInvoke(command, args);
  };
  const guardedOwner = await NativeDeviceSigner.load(guardedInvoke, profile);
  const lateSharing = new DevicePairing(
    new ChainReadSession(chainProfile),
    guardedOwner,
    new EvidenceJournal(),
    guardedInvoke,
  );
  const lateQuote = await lateSharing.prepareDataSharing(
    requestId,
    noCache!.grantId,
    true,
  );
  assert.ok(!("status" in lateQuote));
  const oldTarget = (await lateSharing.inspect(requestId)).grant!;
  beforeShareSignature = async () => {
    const rotator = new SelfPayTransactionManager({
      client: creation.client,
      network: "localnet",
      signer: paired,
      journal: new EvidenceJournal(),
    });
    const rotated = await rotator.submit(
      await rotator.prepare({
        requestId: `pair-rotate:${profile}`,
        gasBudget: 200_000_000n,
        transaction: creation.sdk.productRecord.rotateKey({
          humanId: stableHuman,
          grantId: authorized.grantId,
          organizationId,
          expectedKeyVersion: 1,
        }),
      }),
    );
    assert.equal(rotated.status, "confirmed");
    await effectsVisible(rotated);
    await record({
      action:
        "rotate organization key version after share source checks, before owner native signature",
      digest: rotated.digest,
      actualGas: rotated.actualGas,
    });
  };
  const staleShare = await lateSharing.submit(lateQuote);
  assert.equal(staleShare.status, "failed");
  const failure = staleShare.transaction!.status.error;
  assert.equal(failure?.$kind, "MoveAbort");
  if (failure?.$kind !== "MoveAbort")
    throw new Error("Expected version guard abort");
  assert.equal(failure.MoveAbort.abortCode, "9102");
  assert.equal(failure.MoveAbort.location?.module, "product_record");
  assert.equal(failure.MoveAbort.location?.functionName, "assert_key_version");
  await effectsVisible(staleShare);
  const retained = (await lateSharing.inspect(requestId)).grant!;
  assert.equal(retained.version, oldTarget.version);
  assert.deepEqual(retained.encrypted_keys, oldTarget.encrypted_keys);
  await record({
    action: "atomic key-version guard rejects stale data sharing",
    digest: staleShare.digest,
    actualGas: staleShare.actualGas,
    status: "expected failure",
    failure,
  });
  assert.equal(
    (await lateSharing.query("share", requestId))!.digest,
    staleShare.digest,
  );
  await check(
    "actual key rotation during native signing rejects stale distribution atomically at product_record::assert_key_version 9102, retaining prior envelope/version and actual failed Gas",
  );
  const revoke = await creation.deviceManager.submit(
    await creation.deviceManager.prepare({
      requestId: `revoke-pair:${profile}`,
      gasBudget: 200_000_000n,
      transaction: creation.sdk.identity.revokeDevice({
        humanId: stableHuman,
        grantId: noCache!.grantId,
        targetGrantId: afterData.grantId,
      }),
    }),
  );
  assert.equal(revoke.status, "confirmed");
  await effectsVisible(revoke);
  await record({
    action: "revoke paired device independently",
    digest: revoke.digest,
    actualGas: revoke.actualGas,
  });
  await assert.rejects(applicant.verifyRequester(requestId));
  await assert.rejects(
    reader.read(readHeads.find((r) => r.logicalId === recordInput.logicalId)!),
  );
  state.pairedGrantRevoked = true;
  await check(
    "actual on-chain revocation blocks paired possession and subsequent plaintext release while owner's independent grant remains valid",
  );
  await new DeviceIdentityVerifier(
    new ChainReadSession(chainProfile),
    device,
    noCache!.grantId,
  ).verifyOrganization(organizationId, "approve");
  expected.fill(0);
  keyring.contentKey = "";
  keyring.historicalKeys = {};
  state.phase = "validated_native_pairing";
} catch (error) {
  runFailed = true;
  runError = error;
  state.phase = "failed";
  state.failure = {
    name: error instanceof Error ? error.name : "unknown",
    message:
      error instanceof Error
        ? error.message.replace(
            /FM1:[A-Za-z0-9:]+/g,
            "[redacted recovery code]",
          )
        : "unknown failure",
  };
} finally {
  const cleanup: { profile: string; removed: boolean }[] = [];
  for (const target of [profile, ...recoveryProfiles]) {
    try {
      assert.equal(request("remove", { profile: target }).removed, true);
      cleanup.push({ profile: target, removed: true });
    } catch {
      cleanup.push({ profile: target, removed: false });
    }
  }
  state.credentialCleanup = cleanup;
  state.credentialsRemoved = cleanup.every((entry) => entry.removed);
  complete = !runFailed && state.credentialsRemoved === true;
  await save();
}
if (runFailed) throw runError;
assert.equal(state.credentialsRemoved, true, "test credential cleanup failed");
await save(true);
console.log(
  JSON.stringify({
    passed: checks.length,
    transactions: transactions.length,
    report: output,
  }),
);
