/** Isolated localnet acceptance for the post-onboarding organization flow.
 *
 * This creates a generated native Human and its personal organization first,
 * then uses the same production OrganizationCreation controller to make a
 * second organization. It also demonstrates that a device scoped to the first
 * organization cannot prepare a root-only creation transaction. Nothing in
 * this script accepts a public endpoint or a user-controlled credential. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import {
  createDeviceEncryptionKeys,
  MemoryTransactionJournal,
  randomContentKey,
  SelfPayTransactionManager,
  TransactionPreflightError,
  wrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "../src/chain";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { NativeRecoverySigner } from "../src/native-onboarding";
import { IdentityCreation, normalizeDeployment } from "../src/onboarding";
import {
  OrganizationCreation,
  organizationRequestId,
  restrictedDevices,
} from "../src/organization-create";

assert.ok(process.argv[2] && process.argv[3], "Pass deployment and output reports");
const deployment = JSON.parse(await readFile(process.argv[2], "utf8"));
const output = resolve(process.argv[3]);
try {
  await access(output);
  throw new Error("Inspect the original report; do not overwrite or restart");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const rpc = process.env.FM_LOCALNET_RPC ?? "http://127.0.0.1:29000";
const faucet = process.env.FM_LOCALNET_FAUCET ?? "http://127.0.0.1:29123";
/** A visual-acceptance fixture stops after the real personal organization and
 * deliberately retains only its generated `test-*` device until the browser
 * harness removes it. Normal localnet acceptance always cleans up. */
const browserReady = process.env.FM_ORG_CREATE_BROWSER_READY === "1";
for (const url of [rpc, faucet]) {
  const parsed = new URL(url);
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname),
    "This acceptance spends isolated localnet SUI only.",
  );
}

// Keep this short because the product's exact, durable request locator also
// contains its full Human ID and must satisfy the shared 128-character journal
// bound. The native helper independently refuses non-test profiles.
const profile = `test-org-${randomBytes(4).toString("hex")}`;
const helper = resolve("native/target/debug/examples/device-test-helper");
const checks: string[] = [];
const transactions: Array<Record<string, unknown>> = [];
let created = false;

function request(action: string, extra: Record<string, string> = {}) {
  const result = spawnSync(helper, [], {
    input: JSON.stringify({ action, profile, ...extra }),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1_500_000,
  });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Native test transport failed.");
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
      return request("signOnboarding", { network: args.network, bytes: args.bytes });
    case "fm_device_public":
      return request("public");
    case "fm_device_prove":
      return request("proveDevice", { challenge: args.challenge });
    case "fm_device_sign_transaction":
      return request("signTransaction", { bytes: args.bytes });
    default:
      throw new Error(`Unexpected native call: ${command}`);
  }
};

async function wait<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (true) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch (error) {
      // A confirmed write may still be visible to the second half of a
      // possession proof before its first half. Retry only as a read.
      lastError = error;
    }
    if (Date.now() >= deadline)
      throw lastError ?? new Error("Expected localnet state was not visible");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

try {
  await access(helper);
  const recoveryResult = await NativeRecoverySigner.create(invoke, profile, "localnet");
  created = true;
  const recovery = recoveryResult.signer;
  const device = await NativeDeviceSigner.load(invoke, profile);
  const profileData = normalizeDeployment({
    network: "localnet",
    rpcUrl: rpc,
    packageId: deployment.packageId,
    registryId: deployment.registryId,
    chainIdentifier: deployment.chain.chainIdentifier,
  });
  const creation = new IdentityCreation(
    profileData,
    recovery,
    device,
    new MemoryTransactionJournal(),
  );
  for (const recipient of [
    recovery.material.recovery.address,
    device.device.address,
  ])
    await requestSuiFromFaucetV2({ host: faucet, recipient });

  const humanQuote = await creation.prepareIdentity();
  assert.ok(!("status" in humanQuote));
  const human = await creation.submitIdentity(humanQuote);
  assert.equal(human.status, "confirmed");
  transactions.push({ action: "create Human", digest: human.digest, actualGas: human.actualGas });
  await wait(() => creation.locate(), (value) => value !== null);

  const personalQuote = await creation.prepareOrganization(
    `Personal-${randomUUID().slice(0, 8)}`,
  );
  assert.ok(!("status" in personalQuote));
  const personal = await creation.submitOrganization(personalQuote);
  assert.equal(personal.status, "confirmed");
  transactions.push({ action: "create personal organization", digest: personal.digest, actualGas: personal.actualGas });

  const first = await wait(
    () => creation.locate(),
    (value) => !!value && value.organizations.length === 1,
  );
  assert.ok(first);
  checks.push("onboarding creates exactly one personal organization before the new flow");

  if (browserReady) {
    await writeFile(output, JSON.stringify({
      format: 1,
      recordedAt: new Date().toISOString(),
      browserReady: true,
      profile,
      device: device.device,
      connection: first.profile,
      rootGrantId: first.grantId,
      humanId: first.profile.humanId,
      personalOrganizationId: first.organizations[0].objectId,
      personalOrganizationName: first.organizations[0].name,
      checks,
      limits: {
        network: "isolated localnet only",
        retainedProfile: "generated test-* profile; browser acceptance must remove it",
        privateKeysInReport: false,
      },
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ browserReady: true, report: output }));
  } else {

  const chain = new ChainReadSession(first.profile);
  const createMore = new OrganizationCreation(
    chain,
    device,
    new MemoryTransactionJournal(),
  );
  const beforeOrganizationIds = first.organizations.map((organization) => organization.objectId);
  const requestId = organizationRequestId(
    profile,
    first.profile.humanId,
    randomBytes(8).toString("hex"),
  );
  const secondQuote = await createMore.prepare({
    requestId,
    humanId: first.profile.humanId,
    device: device.device.address,
    name: `Shared-${randomUUID().slice(0, 8)}`,
    description: "Isolated localnet organization creation acceptance",
  });
  assert.ok(!("status" in secondQuote));
  const second = await createMore.submit(secondQuote);
  assert.equal(second.status, "confirmed");
  transactions.push({ action: "create second organization", digest: second.digest, actualGas: second.actualGas });
  const visible = await createMore.awaitCreated(beforeOrganizationIds);
  assert.equal(visible.identity.organizations.length, 2);
  const secondOrganization = visible.identity.organizations.find(
    (organization) => organization.objectId === visible.organizationId,
  );
  assert.ok(secondOrganization);
  assert.equal(secondOrganization.admin, first.profile.humanId);
  assert.equal((await new ChainReadSession(first.profile).human()).organizations.length, 2);
  checks.push("production creation flow rereads the Human directory and selects exactly one new, Human-administered organization");

  // Give an isolated device an organization-scoped grant with APPROVE as well
  // as READ. Its simulated request therefore reaches assert_root and fails on
  // its non-empty org_scope, without any submission/broadcast.
  const scoped = Ed25519Keypair.generate();
  const scopedAddress = scoped.toSuiAddress();
  const scopedKeys = createDeviceEncryptionKeys();
  const contentKey = randomContentKey();
  await requestSuiFromFaucetV2({ host: faucet, recipient: scopedAddress });
  const rootGrant = visible.identity.grants.value?.find(
    (grant) => grant.device === device.device.address && grant.org_scope === null,
  );
  assert.ok(rootGrant);
  const addScopedQuote = await creation.deviceManager.prepare({
    requestId: `org-create-add-scoped:${profile}`,
    gasBudget: 200_000_000n,
    transaction: creation.sdk.identity.addReadDevice({
      identityRegistryId: await creation.sdk.identity.resolveRegistry(),
      humanId: first.profile.humanId,
      grantId: rootGrant.id,
      organizationId: first.organizations[0].objectId,
      device: scopedAddress,
      deviceEncryptionKey: scopedKeys.publicKey,
      encryptedDeviceKeys: await wrapKeys(
        contentKey,
        scopedKeys.publicKey,
        `fractalmind.device-keys.v1:localnet:${scopedAddress}`,
      ),
    }),
  });
  const addedScoped = await creation.deviceManager.submit(addScopedQuote);
  assert.equal(addedScoped.status, "confirmed");
  transactions.push({ action: "add scoped device", digest: addedScoped.digest, actualGas: addedScoped.actualGas });
  const withScoped = await wait(
    () => new ChainReadSession(first.profile).human(),
    (value) => !!value.grants.value?.some((grant) => grant.device === scopedAddress),
  );
  const scopedGrant = withScoped.grants.value!.find((grant) => grant.device === scopedAddress)!;
  const approveQuote = await creation.deviceManager.prepare({
    requestId: `org-create-scope-approve:${profile}`,
    gasBudget: 200_000_000n,
    transaction: creation.sdk.identity.changeDevicePermissions({
      humanId: first.profile.humanId,
      grantId: rootGrant.id,
      targetGrantId: scopedGrant.id,
      organizationId: first.organizations[0].objectId,
      actions: ["read", "approve"],
      expiresAtMs: Date.now() + 3_600_000,
    }),
  });
  const approved = await creation.deviceManager.submit(approveQuote);
  assert.equal(approved.status, "confirmed");
  transactions.push({ action: "give scoped device approve", digest: approved.digest, actualGas: approved.actualGas });

  const current = await wait(
    () => new ChainReadSession(first.profile).human(),
    (value) =>
      !!value.grants.value
      && value.grants.value.some(
        (grant) => grant.id === scopedGrant.id && grant.actions.includes(3),
      ),
  );
  const currentScopedGrant = current.grants.value!.find((grant) => grant.id === scopedGrant.id)!;
  assert.deepEqual(currentScopedGrant.actions, [1, 3]);
  assert.deepEqual(
    restrictedDevices(
      current.grants.value,
      current.human.generation,
      current.clockMs,
      visible.organizationId,
    ).map((grant) => grant.device),
    [scopedAddress],
  );
  const scopedManager = new SelfPayTransactionManager({
    client: creation.client,
    network: "localnet",
    signer: scoped,
    journal: new MemoryTransactionJournal(),
  });
  await assert.rejects(
    scopedManager.prepare({
      requestId: organizationRequestId(profile, first.profile.humanId, randomBytes(8).toString("hex")),
      gasBudget: 200_000_000n,
      transaction: creation.sdk.identity.createOrganization({
        humanId: first.profile.humanId,
        grantId: currentScopedGrant.id,
        name: "Must never be created",
        description: "scoped device negative acceptance",
      }),
    }),
    (error: unknown) =>
      error instanceof TransactionPreflightError && error.code === "simulation_failed",
  );
  checks.push("an organization-scoped device with APPROVE is rejected at simulation for root-only organization creation; no negative transaction was submitted");
  scopedKeys.secret.fill(0);
  contentKey.fill(0);

  await writeFile(output, JSON.stringify({
    format: 1,
    recordedAt: new Date().toISOString(),
    profile,
    chain: { rpc, chainIdentifier: deployment.chain.chainIdentifier },
    humanId: first.profile.humanId,
    personalOrganizationId: first.organizations[0].objectId,
    organizationId: visible.organizationId,
    transactions,
    checks,
    limits: {
      network: "isolated localnet only",
      negativeCreation: "simulation only; no submit",
      nativeTransport: "isolated production native bridge subprocess",
      privateKeysInReport: false,
    },
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ passed: checks.length, report: output }));
  }
} finally {
  if (created && !browserReady) request("remove");
}
