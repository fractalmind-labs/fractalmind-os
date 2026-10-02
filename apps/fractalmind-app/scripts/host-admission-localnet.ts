/** Real Sui integration of the production App controller. All keys are fresh
 * in-memory fixtures; the NativeInvoke transport is injected. This does not
 * prove OS credential-store or installed UI acceptance. No credentials are
 * saved, logged, passed in argv, or reused from a user's wallet. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  FractalMindSDK,
  MemoryTransactionJournal,
  SelfPayTransactionManager,
  createDeviceEncryptionKeys,
  createRecoveryCode,
  recoveryKeys,
  wrapKeys,
  randomContentKey,
  bytesToHex,
  type SelfPayTransactionOutcome,
  type SelfPayFeeQuote,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { HostAdmission } from "../src/host-admission";
import { ChainReadSession } from "../src/chain";

assert.ok(
  process.argv[2] && process.argv[3],
  "Pass existing isolated deployment and a new evidence path",
);
for (const path of [process.argv[3], `${process.argv[3]}.progress.json`]) {
  try {
    await access(path);
    throw new Error(
      "Do not overwrite an existing report or progress; inspect its original transactions",
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
const deployment = JSON.parse(await readFile(process.argv[2], "utf8"));
const baseUrl = "http://127.0.0.1:29000",
  faucet = "http://127.0.0.1:29123";
const coreClient = new SuiGrpcClient({ network: "localnet", baseUrl });
assert.equal(
  (await coreClient.core.getChainIdentifier()).chainIdentifier,
  deployment.chain.chainIdentifier,
);
const sdk = new FractalMindSDK({
  packageId: deployment.packageId,
  registryId: deployment.registryId,
  client: coreClient,
  network: "localnet",
});
const deviceKey = Ed25519Keypair.generate(),
  host = Ed25519Keypair.generate(),
  coordinator = Ed25519Keypair.generate(),
  otherAdmin = Ed25519Keypair.generate();
const encryption = createDeviceEncryptionKeys(),
  hostEncryption = createDeviceEncryptionKeys(),
  adminEncryption = createDeviceEncryptionKeys();
const recovery = recoveryKeys(createRecoveryCode("localnet"), "localnet");
const checks: string[] = [],
  transactions: unknown[] = [];
const journal = new MemoryTransactionJournal();
const invoke: NativeInvoke = async (command, args) => {
  assert.equal(args.profile, "test-host-fixture");
  if (command === "fm_device_public")
    return {
      format: 1,
      profile: args.profile,
      address: deviceKey.toSuiAddress(),
      signingPublicKey: deviceKey.getPublicKey().toBase64(),
      encryptionPublicKey: toBase64(encryption.publicKey),
    };
  if (command === "fm_device_prove")
    return deviceKey.signPersonalMessage(
      new TextEncoder().encode(args.challenge),
    );
  if (command === "fm_device_sign_transaction")
    return deviceKey.signTransaction(fromBase64(args.bytes));
  throw new Error(
    "No initialization/decryption/wrapping commands are allowed by this fixture",
  );
};
const device = await NativeDeviceSigner.load(invoke, "test-host-fixture");
async function save() {
  await writeFile(
    `${process.argv[3]}.progress.json`,
    JSON.stringify(
      {
        complete: false,
        checks,
        transactions,
        limits: {
          generatedFixtureKeysOnly: true,
          invitationSecretsIncluded: false,
        },
      },
      null,
      2,
    ) + "\n",
  );
}
async function record(label: string, outcome: SelfPayTransactionOutcome) {
  transactions.push({
    label,
    requestId: outcome.requestId,
    digest: outcome.digest,
    status: outcome.status,
    actualGas: outcome.actualGas,
  });
  await save();
  assert.equal(
    outcome.status,
    "confirmed",
    `${label}: query original digest ${outcome.digest}`,
  );
  assert.ok(outcome.actualGas !== undefined);
}
async function visible(outcome: SelfPayTransactionOutcome) {
  assert.equal(outcome.status, "confirmed");
  for (const write of outcome.transaction!.effects.changedObjects.filter(
    (x) => x.outputState === "ObjectWrite",
  )) {
    const signal = AbortSignal.timeout(20000);
    while (true) {
      try {
        const { object } = await coreClient.core.getObject({
          objectId: write.objectId,
          signal,
        });
        if (BigInt(object.version) >= BigInt(write.outputVersion!)) break;
      } catch (e) {
        if (signal.aborted) throw e;
      }
      if (signal.aborted)
        throw new Error(
          `Query visibility for ${outcome.digest}; do not replay`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
async function execute(
  label: string,
  transaction: Transaction,
  signer: Ed25519Keypair = deviceKey,
) {
  const manager = new SelfPayTransactionManager({
    client: coreClient,
    network: "localnet",
    signer,
    journal,
  });
  const quote = await manager.prepare({
    requestId: `fixture:${randomUUID()}`,
    transaction,
    gasBudget: 200000000n,
  });
  transactions.push({ label, digest: quote.digest, phase: "prepared" });
  await save();
  const result = await manager.submit(quote);
  await record(label, result);
  await visible(result);
  return result;
}
function created(outcome: SelfPayTransactionOutcome, kind: string) {
  const matches = outcome.transaction!.effects.changedObjects.filter(
    (x) =>
      x.idOperation === "Created" &&
      outcome.transaction!.objectTypes?.[x.objectId] ===
        `${deployment.packageId}::${kind}`,
  );
  assert.equal(matches.length, 1);
  return matches[0].objectId;
}
await Promise.all(
  [deviceKey, recovery.signer, host, otherAdmin].map((signer) =>
    requestSuiFromFaucetV2({ host: faucet, recipient: signer.toSuiAddress() }),
  ),
);
const identityRegistryId = await sdk.identity.resolveRegistry();
const keyring = new TextEncoder().encode(
  JSON.stringify({
    format: 1,
    contentKey: bytesToHex(randomContentKey()),
    historicalKeys: {},
  }),
);
const made = await execute(
  "create isolated fixture Human",
  sdk.identity.createIdentity({
    identityRegistryId,
    network: "localnet",
    recoverySigningKey: recovery.signingPublicKey,
    recoveryEncryptionKey: recovery.encryptionPublicKey,
    encryptedBackup: await wrapKeys(
      keyring,
      recovery.encryptionPublicKey,
      `fractalmind.recovery-backup.v1:localnet:${recovery.address}`,
    ),
    device: deviceKey.toSuiAddress(),
    deviceEncryptionKey: encryption.publicKey,
    encryptedDeviceKeys: await wrapKeys(
      keyring,
      encryption.publicKey,
      `fractalmind.device-keys.v1:localnet:${deviceKey.toSuiAddress()}`,
    ),
  }),
  recovery.signer,
);
const adminEnvelope = await wrapKeys(
  keyring,
  adminEncryption.publicKey,
  `fractalmind.device-keys.v1:localnet:${otherAdmin.toSuiAddress()}`,
);
keyring.fill(0);
const humanId = created(made, "identity::HumanIdentity"),
  grantId = created(made, "identity::DeviceGrant");
const org = await execute(
  "create isolated fixture organization",
  sdk.identity.createOrganization({
    humanId,
    grantId,
    name: `Host-App-${randomUUID()}`,
    description: "generated fixture keys; no deployed runtimes",
  }),
);
const organizationId = created(org, "organization::Organization");
const profile = {
  network: "localnet" as const,
  rpcUrl: baseUrl,
  packageId: deployment.packageId,
  registryId: deployment.registryId,
  humanId,
  chainIdentifier: deployment.chain.chainIdentifier,
};
let controller = new HostAdmission(
  new ChainReadSession(profile),
  device,
  grantId,
  organizationId,
  journal,
);
assert.deepEqual((await controller.directory()).invitations, []);
checks.push("exact absent Host index reconstructs as empty");
const bindingAttempt = randomUUID();
const bindingQuote = await controller.prepare(
  {
    kind: "binding",
    endpoint: "http://127.0.0.1:19090",
    publicKey: bytesToHex(coordinator.getPublicKey().toRawBytes()),
  },
  bindingAttempt,
  true,
);
assert.ok(!("status" in bindingQuote));
const bindingOutcome = await controller.submit(bindingQuote);
await record("App registers Coordinator binding", bindingOutcome);
assert.equal(await controller.awaitVisible(bindingOutcome), true);
const bindingId = created(bindingOutcome, "host::CoordinatorBinding");
assert.equal(
  (await controller.directory()).bindings[0].coordinator_address,
  coordinator.toSuiAddress(),
);
checks.push(
  "production verifier proves fresh device/organization management authority; public binding is not online evidence",
);
const operation = {
  kind: "invite" as const,
  bindingId,
  ttlMinutes: 60 as const,
  membershipDays: 30,
  observationHours: 24,
};
async function invite(label: string) {
  const attemptId = randomUUID(),
    quote = await controller.prepare(operation, attemptId, true);
  assert.ok(!("status" in quote));
  const outcome = await controller.submit(quote);
  await record(label, outcome);
  const result = await controller.createdInvite(outcome);
  assert.ok(result.code);
  return { ...result, outcome, attemptId };
}
const first = await invite("App creates one-use invitation");
let envdQuote: unknown;
if (process.env.FM_ENVD_JOIN_QUOTE_BIN) {
  const helper = spawn(
    process.env.FM_ENVD_JOIN_QUOTE_BIN,
    ["-test.run=^TestHostJoinLiveQuote$", "-test.v"],
    {
      env: { ...process.env, FM_HOST_JOIN_LIVE_QUOTE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "",
    diagnostic = "";
  helper.stdout.on("data", (part) => {
    output += String(part);
  });
  helper.stderr.on("data", (part) => {
    diagnostic += String(part);
  });
  const done = new Promise<void>((resolve, reject) => {
    helper.once("error", reject);
    helper.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `envd quote fixture failed (${code}): ${output} ${diagnostic}`,
            ),
          ),
    );
  });
  helper.stdin.end(
    JSON.stringify({
      Code: first.code,
      Network: "localnet",
      PackageID: deployment.packageId,
      RegistryID: deployment.registryId,
      OrganizationID: organizationId,
      HostAddress: host.toSuiAddress(),
      ChainIdentifier: deployment.chain.chainIdentifier,
      HostPublicKey: toBase64(host.getPublicKey().toRawBytes()),
      EncryptionPublicKey: toBase64(hostEncryption.publicKey),
    }),
  );
  await done;
  const line = output
    .split("\n")
    .find((line) => line.startsWith("FM_HOST_JOIN_QUOTE "));
  assert.ok(line, "envd fixture produced no public quote");
  envdQuote = JSON.parse(line.slice("FM_HOST_JOIN_QUOTE ".length));
  checks.push(
    "production Go envd inspects exact App invitation and validates live gRPC BCS quote; no broadcast or OS/CLI acceptance",
  );
}
checks.push(
  "code is released only after exact receipt objects are visible and match invitation proof material",
);
const redemption = await sdk.host.prepareJoin({
  code: first.code,
  network: "localnet",
  hostPublicKey: host.getPublicKey().toRawBytes(),
  encryptionPublicKey: hostEncryption.publicKey,
  name: "fixture Host (not deployed envd)",
});
const joined = await execute(
  "SDK fixture Host redeems App invitation",
  redemption.transaction,
  host,
);
const membershipId = created(joined, "host::HostMembership");
const rebuilt = await controller.directory();
assert.equal(
  rebuilt.invitations.find((i) => i.id === first.invite.id)!.uses,
  1,
);
assert.equal(rebuilt.memberships[0].id, membershipId);
const cap = await sdk.remoteAuthority.getCapability(
  rebuilt.memberships[0].observation_capability,
);
assert.equal(cap.actions.includes("direct.message"), false);
assert.equal(cap.maxUses, 10000n);
assert.equal((await controller.createdInvite(first.outcome)).code, null);
await assert.rejects(
  controller.prepare(
    { kind: "revoke-invite", targetId: first.invite.id },
    randomUUID(),
    true,
  ),
  /unavailable/,
);
checks.push(
  "redemption consumes the invitation; reconstruction finds membership and finite observation authority, not execution authority",
);
const revokeMember = await controller.prepare(
  { kind: "revoke-member", targetId: membershipId },
  randomUUID(),
  true,
);
assert.ok(!("status" in revokeMember));
const revoked = await controller.submit(revokeMember);
await record("App revokes Host membership", revoked);
assert.equal(await controller.awaitVisible(revoked), true);
assert.equal((await controller.directory()).memberships[0].revoked, true);
checks.push(
  "membership revocation remains chain-owned and visible; consumed-invite revocation never substitutes for it",
);
const second = await invite("App creates invitation for reload test");
controller.dispose();
controller = new HostAdmission(
  new ChainReadSession(profile),
  device,
  grantId,
  organizationId,
  journal,
);
assert.equal((await controller.createdInvite(second.outcome)).code, null);
assert.equal((await controller.directory()).invitations.length, 2);
checks.push(
  "new controller reconstructs chain state but cannot recover the invitation bearer secret",
);
const revokeInvite = await controller.prepare(
  { kind: "revoke-invite", targetId: second.invite.id },
  randomUUID(),
  true,
);
assert.ok(!("status" in revokeInvite));
const revokedInvite = await controller.submit(revokeInvite);
await record("App revokes unrecoverable unused invitation", revokedInvite);
assert.equal(await controller.awaitVisible(revokedInvite), true);
assert.equal(
  (await controller.directory()).invitations.find(
    (i) => i.id === second.invite.id,
  )!.revoked,
  true,
);
checks.push("a lost unused code has an explicit on-chain revocation path");
const adminAdded = await execute(
  "fixture explicitly adds independent root management device",
  sdk.identity.addRootDevice({
    identityRegistryId,
    humanId,
    grantId,
    device: otherAdmin.toSuiAddress(),
    deviceEncryptionKey: adminEncryption.publicKey,
    encryptedDeviceKeys: adminEnvelope,
    expiresAtMs: Date.now() + 86400000,
  }),
);
const otherGrantId = created(adminAdded, "identity::DeviceGrant");
const late = await controller.prepare(operation, randomUUID(), true);
assert.ok(!("status" in late));
await execute(
  "independent root fixture revokes managing device",
  sdk.identity.revokeDevice({
    humanId,
    grantId: otherGrantId,
    targetGrantId: grantId,
  }),
  otherAdmin,
);
await assert.rejects(
  controller.submit(late as SelfPayFeeQuote),
  /invalid_grant/,
);
controller.dispose();
checks.push(
  "management revocation between quote and submit rejects the App operation before a new broadcast",
);
encryption.secret.fill(0);
hostEncryption.secret.fill(0);
adminEncryption.secret.fill(0);
recovery.encryptionSecret.fill(0);
const report = {
  recordedAt: new Date().toISOString(),
  chainIdentifier: deployment.chain.chainIdentifier,
  profile,
  organizationId,
  grantId,
  checks,
  transactions,
  envdQuote,
  limits: {
    generatedFixtureKeysOnly: true,
    injectedNativeTransport: true,
    memoryTechnicalJournal: true,
    installedAppVerified: false,
    nativeStoreVerified: false,
    envdJoinCliVerified: false,
    envdJoinQuoteVerified: !!envdQuote,
    cloudHostVerified: false,
    invitationSecretsIncluded: false,
  },
};
await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    checks: checks.length,
    confirmedTransactions: transactions.filter(
      (x: any) => x.status === "confirmed",
    ).length,
    output: process.argv[3],
  }),
);
