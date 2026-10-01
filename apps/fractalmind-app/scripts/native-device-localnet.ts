/** Only generated test-* credentials in the separate native test service.
 * Node receives public keys/signatures; the native private keys stay in the OS.
 * Recovery keys below are ephemeral fixtures, not the App recovery UI. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, normalizeSuiAddress, toBase64 } from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import {
  FractalMindSDK,
  SelfPayTransactionManager,
  MemoryTransactionJournal,
  TransactionPreflightError,
  createDeviceEncryptionKeys,
  createRecoveryCode,
  recoveryKeys,
  randomContentKey,
  wrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device.ts";
import { ChainReadSession } from "../src/chain.ts";
import { DeviceIdentityVerifier } from "../src/device-identity.ts";

assert.ok(
  process.argv[2] && process.argv[3],
  "Pass the isolated deployment report and public output report.",
);
const deployment = JSON.parse(await readFile(process.argv[2], "utf8"));
const rpc = process.env.FM_LOCALNET_RPC ?? "http://127.0.0.1:29000";
const faucet = process.env.FM_LOCALNET_FAUCET ?? "http://127.0.0.1:29123";
for (const url of [rpc, faucet])
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    "Only localnet test SUI is allowed.",
  );
assert.equal(
  process.platform,
  "darwin",
  "This acceptance records actual macOS Keychain use only.",
);
const helper = resolve("native/target/debug/examples/device-test-helper");
const profile = `test-${randomUUID()}`;
function request(action: string, extra: Record<string, string> = {}) {
  const result = spawnSync(helper, [], {
    input: JSON.stringify({ action, profile, ...extra }),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2_000_000,
  });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Native test transport failed.");
  return JSON.parse(result.stdout);
}
const invoke: NativeInvoke = async (command, args) => {
  assert.equal(args.profile, profile);
  switch (command) {
    case "fm_device_initialize":
      return request("initialize");
    case "fm_device_public":
      return request("public");
    case "fm_device_sign_transaction":
      return request("signTransaction", { bytes: args.bytes });
    case "fm_device_prove":
      return request("proveDevice", { challenge: args.challenge });
  }
};
const client = new SuiGrpcClient({ baseUrl: rpc, network: "localnet" });
const sdk = new FractalMindSDK({
  packageId: deployment.packageId,
  registryId: deployment.registryId,
  client,
  network: "localnet",
});
const checks: string[] = [];
const rows: Record<string, unknown>[] = [];
let initialized = false;
try {
  assert.throws(() => request("public"), /NotInitialized/);
  checks.push("missing profile is not implicitly initialized");
  const signer = await NativeDeviceSigner.initialize(invoke, profile);
  initialized = true;
  assert.deepEqual(
    (await NativeDeviceSigner.load(invoke, profile)).device,
    signer.device,
  );
  assert.deepEqual(
    (await NativeDeviceSigner.initialize(invoke, profile)).device,
    signer.device,
  );
  checks.push(
    "new processes reload the same OS keys; explicit initialization is idempotent",
  );
  const offline = async (sender: string, owner: string) => {
    const tx = new Transaction();
    tx.setSender(sender);
    tx.setGasOwner(owner);
    tx.setGasPrice(1000);
    tx.setGasBudget(10_000_000);
    tx.setGasPayment([
      {
        objectId: normalizeSuiAddress("0x123"),
        version: "1",
        digest: "1".repeat(32),
      },
    ]);
    return tx.build();
  };
  assert.throws(
    () => request("signTransaction", { bytes: "invalid" }),
    /InvalidTransaction/,
  );
  assert.throws(
    () =>
      request("signTransaction", { bytes: toBase64(new Uint8Array([0, 0])) }),
    /InvalidTransaction/,
  );
  assert.throws(
    () => request("signTransaction", { bytes: "" }),
    /InvalidTransaction/,
  );
  const trailing = toBase64(
    Buffer.concat([
      await offline(normalizeSuiAddress("0x1"), signer.device.address),
      Buffer.from([0]),
    ]),
  );
  assert.throws(
    () => request("signTransaction", { bytes: trailing }),
    /InvalidTransaction/,
  );
  const wrongSender = toBase64(
    await offline(normalizeSuiAddress("0x1"), signer.device.address),
  );
  assert.throws(
    () => request("signTransaction", { bytes: wrongSender }),
    /WrongSender/,
  );
  const wrongOwner = toBase64(
    await offline(signer.device.address, normalizeSuiAddress("0x1")),
  );
  assert.throws(
    () => request("signTransaction", { bytes: wrongOwner }),
    /WrongGasOwner/,
  );
  checks.push(
    "native BCS parser rejects malformed/trailing bytes, foreign sender and sponsored gas",
  );
  const valid = await offline(signer.device.address, signer.device.address);
  await signer.signTransaction(valid);
  checks.push(
    "Rust transaction intent/hash/signature verified independently by Mysten JS",
  );

  const chain = await client.core.getChainIdentifier();
  assert.equal(
    chain.chainIdentifier,
    deployment.chain.chainIdentifier,
    "Isolated deployment chain changed.",
  );
  await requestSuiFromFaucetV2({
    host: faucet,
    recipient: signer.device.address,
  });
  const recovery = recoveryKeys(createRecoveryCode("localnet"), "localnet");
  await requestSuiFromFaucetV2({ host: faucet, recipient: recovery.address });
  const keyring = randomContentKey();
  const encryptedBackup = await wrapKeys(
    keyring,
    recovery.encryptionPublicKey,
    `fractalmind.recovery-backup.v1:localnet:${recovery.address}`,
  );
  const encryptedDeviceKeys = await wrapKeys(
    keyring,
    fromBase64(signer.device.encryptionPublicKey),
    `fractalmind.device-keys.v1:localnet:${signer.device.address}`,
  );
  // In-memory journals are isolated test fixtures. The App uses durable IDB.
  const recoveryManager = new SelfPayTransactionManager({
    client,
    network: "localnet",
    signer: recovery.signer,
    journal: new MemoryTransactionJournal(),
  });
  const identityQuote = await recoveryManager.prepare({
    requestId: `identity-${profile}`,
    gasBudget: 200_000_000n,
    transaction: sdk.identity.createIdentity({
      identityRegistryId: await sdk.identity.resolveRegistry(),
      network: "localnet",
      recoverySigningKey: recovery.signingPublicKey,
      recoveryEncryptionKey: recovery.encryptionPublicKey,
      encryptedBackup,
      device: signer.device.address,
      deviceEncryptionKey: fromBase64(signer.device.encryptionPublicKey),
      encryptedDeviceKeys,
    }),
  });
  const made = await recoveryManager.submit(identityQuote);
  assert.equal(made.status, "confirmed", `Identity fixture: ${made.reason}`);
  rows.push({
    action: "create generated Human fixture",
    digest: made.digest,
    gasUsed: made.gasUsed,
  });
  const created = (suffix: string) => {
    const ids = Object.entries(made.transaction!.objectTypes ?? {})
      .filter(([, type]) => type.endsWith(suffix))
      .map(([id]) => id);
    assert.equal(ids.length, 1);
    return ids[0];
  };
  const humanId = created("::identity::HumanIdentity"),
    grantId = created("::identity::DeviceGrant");
  // Wait read-only for the exact created objects. Never resubmit a known digest.
  async function visible<T>(read: () => Promise<T>) {
    const deadline = Date.now() + 20_000;
    while (true) {
      try {
        return await read();
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
  const human = await visible(() => sdk.identity.getHuman(humanId));
  const grant = await visible(() => sdk.identity.getDeviceGrant(grantId));
  assert.equal(grant.human_id, human.id);
  assert.equal(grant.device, signer.device.address);
  assert.equal(grant.generation, human.generation);
  assert.equal(grant.revoked, false);
  const proofInput = {
    chainIdentifier: chain.chainIdentifier,
    humanId,
    grantId,
    nonce: randomBytes(16).toString("hex"),
    expiresAtMs: Date.now() + 60_000,
  };
  const proof = await signer.proveDevice(proofInput);
  await verifyPersonalMessageSignature(
    new TextEncoder().encode(proof.challenge),
    proof.signature,
    { address: grant.device },
  );
  assert.throws(
    () =>
      request("proveDevice", {
        challenge: proof.challenge.replace(/:[0-9]+$/, ":1"),
      }),
    /InvalidProof/,
  );
  assert.throws(
    () => request("proveDevice", { challenge: "please-sign-a-wallet-login" }),
    /InvalidProof/,
  );
  checks.push(
    "native personal-message proof verifies against actual chain grant; stale/unscoped proof rejected",
  );

  const verified = await new DeviceIdentityVerifier(
    new ChainReadSession({
      network: "localnet",
      rpcUrl: rpc,
      packageId: deployment.packageId,
      registryId: deployment.registryId,
      humanId,
      chainIdentifier: chain.chainIdentifier,
    }),
    signer,
    grantId,
  ).verify();
  assert.equal(verified.humanId, humanId);
  assert.equal(verified.device, signer.device.address);
  assert.ok(verified.actions.includes("approve"));
  assert.equal(verified.organizationScope, null);
  checks.push(
    "formal verifier checks actual BCS source/UID/shared owner, generation, encryption key, expiry, possession and stable versions",
  );

  const journal = new MemoryTransactionJournal();
  const manager = new SelfPayTransactionManager({
    client,
    network: "localnet",
    signer: await NativeDeviceSigner.load(invoke, profile),
    journal,
  });
  const requestId = `organization-${profile}`;
  const quote = await manager.prepare({
    requestId,
    gasBudget: 200_000_000n,
    transaction: sdk.identity.createOrganization({
      humanId,
      grantId,
      name: `Native-App-${profile}`,
      description: "Generated macOS device signing acceptance",
    }),
  });
  assert.equal(quote.sender, signer.device.address);
  const result = await manager.submit(quote);
  assert.equal(
    result.status,
    "confirmed",
    `Native transaction: ${result.reason}`,
  );
  assert.equal(result.transaction!.transaction!.sender, signer.device.address);
  assert.equal(
    result.transaction!.transaction!.gasData.owner,
    signer.device.address,
  );
  const organizations = Object.entries(result.transaction!.objectTypes ?? {})
    .filter(([, type]) => type.endsWith("::organization::Organization"))
    .map(([id]) => id);
  assert.equal(organizations.length, 1);
  const organization = await visible(() =>
    sdk.organization.getOrganization(organizations[0]),
  );
  assert.equal(organization.admin, humanId);
  const reread = new SelfPayTransactionManager({
    client,
    network: "localnet",
    signer: await NativeDeviceSigner.load(invoke, profile),
    journal,
  });
  assert.equal((await reread.query(requestId))?.digest, result.digest);
  rows.push({
    action: "native device self-pays creation of actual organization",
    digest: result.digest,
    sender: quote.sender,
    estimatedGas: quote.estimatedGas,
    gasUsed: result.gasUsed,
    actualGas: result.actualGas,
    humanId,
    grantId,
    organizationId: organizations[0],
  });
  checks.push(
    "actual Sui organization transaction simulated, signed natively, verified and paid by device",
  );
  checks.push("new manager queries original digest without another broadcast");

  // A separately generated authorizer avoids aliasing the same immutable and
  // mutable DeviceGrant in Move. This JS key is a fixture, not an App device.
  const revoker = Ed25519Keypair.generate(),
    revokerKeys = createDeviceEncryptionKeys();
  const revokerAddress = revoker.toSuiAddress();
  const addQuote = await manager.prepare({
    requestId: `authorize-fixture-${profile}`,
    gasBudget: 200_000_000n,
    transaction: sdk.identity.addRootDevice({
      identityRegistryId: await sdk.identity.resolveRegistry(),
      humanId,
      grantId,
      device: revokerAddress,
      deviceEncryptionKey: revokerKeys.publicKey,
      encryptedDeviceKeys: await wrapKeys(
        keyring,
        revokerKeys.publicKey,
        `fractalmind.device-keys.v1:localnet:${revokerAddress}`,
      ),
      expiresAtMs: Date.now() + 86_400_000,
    }),
  });
  const added = await manager.submit(addQuote);
  assert.equal(added.status, "confirmed");
  const revokerGrants = Object.entries(added.transaction!.objectTypes ?? {})
    .filter(([, type]) => type.endsWith("::identity::DeviceGrant"))
    .map(([id]) => id);
  assert.equal(revokerGrants.length, 1);
  await visible(() => sdk.identity.getDeviceGrant(revokerGrants[0]));
  await requestSuiFromFaucetV2({ host: faucet, recipient: revokerAddress });
  const revokerManager = new SelfPayTransactionManager({
    client,
    network: "localnet",
    signer: revoker,
    journal: new MemoryTransactionJournal(),
  });
  const revokeQuote = await revokerManager.prepare({
    requestId: `revoke-native-${profile}`,
    gasBudget: 200_000_000n,
    transaction: sdk.identity.revokeDevice({
      humanId,
      grantId: revokerGrants[0],
      targetGrantId: grantId,
    }),
  });
  const revoked = await revokerManager.submit(revokeQuote);
  assert.equal(revoked.status, "confirmed");
  await visible(async () => {
    const current = await sdk.identity.getDeviceGrant(grantId);
    assert.equal(current.revoked, true);
    return current;
  });
  await assert.rejects(
    new DeviceIdentityVerifier(
      new ChainReadSession({
        network: "localnet",
        rpcUrl: rpc,
        packageId: deployment.packageId,
        registryId: deployment.registryId,
        humanId,
        chainIdentifier: chain.chainIdentifier,
      }),
      signer,
      grantId,
    ).verify(),
    /invalid_grant/,
  );
  await assert.rejects(
    manager.prepare({
      requestId: `revoked-reject-${profile}`,
      gasBudget: 200_000_000n,
      transaction: sdk.identity.createOrganization({
        humanId,
        grantId,
        name: "Must reject revoked device",
        description: "negative fixture",
      }),
    }),
    (error: unknown) =>
      error instanceof TransactionPreflightError &&
      error.code === "simulation_failed",
  );
  rows.push({
    action: "native device explicitly adds isolated authorizer fixture",
    digest: added.digest,
    gasUsed: added.gasUsed,
  });
  rows.push({
    action: "authorizer revokes native device on Sui",
    digest: revoked.digest,
    gasUsed: revoked.gasUsed,
  });
  checks.push(
    "actual on-chain revocation invalidates login and rejects another organization transaction before signing/broadcast",
  );
  revokerKeys.secret.fill(0);
  keyring.fill(0);
  recovery.encryptionSecret.fill(0);
  request("remove");
  initialized = false;
  assert.throws(() => request("public"), /NotInitialized/);
  await assert.rejects(signer.signTransaction(valid), /not_initialized/);
  checks.push(
    "test credential removed; existing signer fails without recreating it",
  );
  const report = {
    schema: "fractalmind.v020-app-native-device.v1",
    testedAt: new Date().toISOString(),
    platform: process.platform,
    chain,
    packageId: deployment.packageId,
    registryId: deployment.registryId,
    device: signer.device,
    checks,
    transactions: rows,
    testCredentialRemoved: true,
    evidenceLimits: {
      transport: "isolated subprocess test helper, not installed WebView IPC",
      recovery: "ephemeral JS test fixture, not native recovery flow",
      journal: "memory test fixture; durable browser journal tested separately",
      desktopShellVerified: false,
      privateBodyDecryptVerified: false,
      windowsLinuxMobileVerified: false,
      fullV020Acceptance: false,
    },
  };
  await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
  console.log(
    `Native macOS device acceptance PASS: ${checks.length} checks, ${rows.length} actual chain transactions; generated test credential removed.`,
  );
} finally {
  if (initialized) request("remove");
}
