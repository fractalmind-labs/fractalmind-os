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
  if (created) request("remove");
}
