/** #64 acceptance on an isolated localnet: this computer becomes the
 * organization's Host + Coordinator through the production setup controller
 * (src/local-host.ts), the App's native Layout code (via the local-host-helper
 * example) and the bundled envd, installed as a real per-user service.
 * Device and recovery keys are fresh in-memory fixtures; the Host key lives in
 * the OS credential store under a throwaway profile and is removed at the end.
 * The report contains public identifiers only, never the invitation. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { access, readFile, writeFile, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { HostAdmission } from "../src/host-admission";
import { ChainReadSession } from "../src/chain";
import { CoordinatorReadClient } from "../src/coordinator-read";
import { coordinatorHosts } from "../src/host-observations";
import { verifyHostObservations } from "../src/host-signatures";
import {
  LocalHostNative,
  localMembership,
  setupLocalHost,
  type SetupPhase,
} from "../src/local-host";

const [deploymentPath, reportPath, helperArg, envdArg] = process.argv.slice(2);
// launchd needs absolute program paths, as the App's bundled sidecar has.
const helperBin = resolve(helperArg ?? ""),
  envdBin = resolve(envdArg ?? "");
assert.ok(
  deploymentPath && reportPath && helperArg && envdArg,
  "Pass deployment JSON, a new report path, local-host-helper and envd binaries",
);
try {
  await access(reportPath);
  throw new Error("Do not overwrite an existing report");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const baseUrl = process.env.FM_LOCALNET_RPC ?? "http://127.0.0.1:29000",
  faucet = process.env.FM_LOCALNET_FAUCET ?? "http://127.0.0.1:29123";
for (const url of [baseUrl, faucet])
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/, "loopback localnet only");
const deployment = JSON.parse(await readFile(deploymentPath, "utf8"));
const client = new SuiGrpcClient({ network: "localnet", baseUrl });
const chainIdentifier = (await client.core.getChainIdentifier()).chainIdentifier;
assert.equal(chainIdentifier, deployment.chain.chainIdentifier);
const sdk = new FractalMindSDK({
  packageId: deployment.packageId,
  okrPackageId: deployment.okrPackageId,
  directPackageId: deployment.directPackageId,
  registryId: deployment.registryId,
  client,
  network: "localnet",
});
const checks: string[] = [];
const transactions: unknown[] = [];
const report: Record<string, unknown> = {
  issue: 64,
  network: "localnet",
  chainIdentifier,
  checks,
  transactions,
  limits: {
    generatedFixtureDeviceKeysOnly: true,
    invitationIncluded: false,
    installedAppUiExercised: false,
  },
};
const save = () =>
  writeFile(`${reportPath}.progress.json`, JSON.stringify(report, null, 2) + "\n");

// --- Fixture Human, organization and management device (in memory). ---
const deviceKey = Ed25519Keypair.generate();
const encryption = createDeviceEncryptionKeys();
const recovery = recoveryKeys(createRecoveryCode("localnet"), "localnet");
const deviceInvoke: NativeInvoke = async (command, args) => {
  if (command === "fm_device_public")
    return {
      format: 1,
      profile: args.profile,
      address: deviceKey.toSuiAddress(),
      signingPublicKey: deviceKey.getPublicKey().toBase64(),
      encryptionPublicKey: toBase64(encryption.publicKey),
    };
  if (command === "fm_device_prove")
    return deviceKey.signPersonalMessage(new TextEncoder().encode(args.challenge));
  if (command === "fm_device_sign_transaction")
    return deviceKey.signTransaction(fromBase64(args.bytes));
  throw new Error(`fixture does not allow ${command}`);
};
const device = await NativeDeviceSigner.load(deviceInvoke, "test-local-host");
const journal = new MemoryTransactionJournal();
async function execute(label: string, tx: Transaction, signer: Ed25519Keypair) {
  const manager = new SelfPayTransactionManager({ client, network: "localnet", signer, journal });
  const quote = await manager.prepare({ requestId: `fixture:${randomUUID()}`, transaction: tx, gasBudget: 200000000n });
  const outcome = await manager.submit(quote);
  transactions.push({ label, digest: outcome.digest, status: outcome.status, actualGas: outcome.actualGas });
  await save();
  assert.equal(outcome.status, "confirmed", label);
  for (const write of outcome.transaction!.effects.changedObjects.filter((x) => x.outputState === "ObjectWrite")) {
    for (let i = 0; ; i++) {
      try {
        const { object } = await client.core.getObject({ objectId: write.objectId });
        if (BigInt(object.version) >= BigInt(write.outputVersion!)) break;
      } catch {}
      assert.ok(i < 200, `query ${outcome.digest}; do not replay`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return outcome;
}
function created(outcome: SelfPayTransactionOutcome, kind: string) {
  const ids = outcome.transaction!.effects.changedObjects.filter(
    (x) => x.idOperation === "Created" && outcome.transaction!.objectTypes?.[x.objectId] === `${deployment.packageId}::${kind}`,
  );
  assert.equal(ids.length, 1);
  return ids[0].objectId;
}
await Promise.all(
  [deviceKey, recovery.signer].map((s) => requestSuiFromFaucetV2({ host: faucet, recipient: s.toSuiAddress() })),
);
const identityRegistryId = await sdk.identity.resolveRegistry();
const keyring = new TextEncoder().encode(
  JSON.stringify({ format: 1, contentKey: bytesToHex(randomContentKey()), historicalKeys: {} }),
);
const made = await execute(
  "fixture Human",
  sdk.identity.createIdentity({
    identityRegistryId,
    network: "localnet",
    recoverySigningKey: recovery.signingPublicKey,
    recoveryEncryptionKey: recovery.encryptionPublicKey,
    encryptedBackup: await wrapKeys(keyring, recovery.encryptionPublicKey, `fractalmind.recovery-backup.v1:localnet:${recovery.address}`),
    device: deviceKey.toSuiAddress(),
    deviceEncryptionKey: encryption.publicKey,
    encryptedDeviceKeys: await wrapKeys(keyring, encryption.publicKey, `fractalmind.device-keys.v1:localnet:${deviceKey.toSuiAddress()}`),
  }),
  recovery.signer,
);
keyring.fill(0);
const humanId = created(made, "identity::HumanIdentity"),
  grantId = created(made, "identity::DeviceGrant");
const org = await execute(
  "fixture organization",
  sdk.identity.createOrganization({ humanId, grantId, name: `Local-Host-${randomUUID()}`, description: "#64 acceptance fixture" }),
  deviceKey,
);
const organizationId = created(org, "organization::Organization");
const profile = {
  network: "localnet" as const,
  rpcUrl: baseUrl,
  packageId: deployment.packageId,
  okrPackageId: deployment.okrPackageId,
  directPackageId: deployment.directPackageId,
  registryId: deployment.registryId,
  humanId,
  chainIdentifier,
};
const chain = new ChainReadSession(profile);
const admission = new HostAdmission(chain, device, grantId, organizationId, journal);

// --- The App's native layer, through the helper process. ---
const data = await mkdtemp(join(tmpdir(), "fm-local-host-"));
const hostProfile = `test-e2e-${randomUUID().slice(0, 8)}`;
const helper = spawn(helperBin, [data, envdBin, hostProfile], { stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: helper.stdout! })[Symbol.asyncIterator]();
const nativeCalls: string[] = [];
const hostInvoke = (async (command: string, args: Record<string, unknown>) => {
  assert.equal(args.profile, hostProfile);
  const name = command.replace("fm_local_host_", "");
  nativeCalls.push(name === "join" ? `join:${args.invitation ? "code" : "none"}` : name);
  helper.stdin!.write(JSON.stringify({ command: name, ...args }) + "\n");
  const { value } = await lines.next();
  const response = JSON.parse(value);
  if ("error" in response) throw response.error;
  return response.ok;
}) as <T>(command: string, args: Record<string, unknown>) => Promise<T>;
const native = new LocalHostNative(hostInvoke);
const phases: SetupPhase[] = [];
const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};
let uninstalled = false;
try {
  const before = await native.status(hostProfile);
  assert.equal(before.configured, null);
  assert.equal(before.service, "not_installed");
  const port = before.suggestedPort!;
  assert.ok(port >= 7443 && port < 7463);
  checks.push("fresh profile: not configured, service not installed, free loopback port suggested");

  const started = Date.now();
  const result = await setupLocalHost(
    {
      native,
      chain,
      admission,
      deviceProfile: hostProfile,
      organizationId,
      hostName: "Acceptance Mac",
      port,
      storage,
      onPhase: (p) => phases.push(p),
    },
  );
  report.setupMs = Date.now() - started;
  for (const outcome of result.fees)
    transactions.push({ label: "setup (device-signed)", digest: outcome.digest, status: outcome.status, actualGas: outcome.actualGas });
  transactions.push({ label: "setup join (Host-signed)", actualFeeMist: result.joinFee });
  report.phases = phases;
  report.nativeCalls = [...nativeCalls];
  report.host = { address: result.keys.host_address, bindingId: result.bindingId, membershipId: result.membershipId, endpoint: result.endpoint };
  await save();
  assert.equal(result.endpoint, `http://127.0.0.1:${port}`);
  assert.deepEqual(nativeCalls.filter((c) => c.startsWith("join")), ["join:none", "join:code"]);
  checks.push("one call: keys → device binding → config → funded invite → Host join over stdin → service, no invitation outside memory/stdin");

  // Chain state.
  const directory = await admission.directory();
  const binding = directory.bindings.find((b) => b.id === result.bindingId)!;
  assert.equal(binding.coordinator_address, result.keys.host_address);
  assert.equal(binding.endpoint, result.endpoint);
  assert.equal(directory.invitations.length, 1);
  assert.equal(directory.invitations[0].uses, 1);
  assert.ok(localMembership(directory, result.keys, result.bindingId));
  checks.push("chain: binding to this Host's key on loopback, invitation consumed, membership active");
  const hostBalance = BigInt((await client.core.getBalance({ owner: result.keys.host_address })).balance.balance);
  report.hostBalanceAfterJoinMist = hostBalance.toString();
  assert.ok(hostBalance > 0n && hostBalance < 100_000_000n);
  checks.push("the Host was funded in the invite PTB and paid its own join Gas");

  // Service and authenticated Coordinator reads.
  const status = await native.status(hostProfile);
  assert.equal(status.service, "running");
  assert.ok(status.listening && status.pid);
  report.service = { pid: status.pid, log: status.logPath };
  const plist = join(homedir(), "Library/LaunchAgents", `org.fractalmind.envd.${hostProfile}.plist`);
  assert.ok(existsSync(plist));
  assert.match(await readFile(plist, "utf8"), /<key>RunAtLoad<\/key><true\/>/);
  checks.push("launchd LaunchAgent installed with RunAtLoad/KeepAlive and running");
  const reads = new CoordinatorReadClient(chain, device, grantId, organizationId);
  let hosts: ReturnType<typeof coordinatorHosts> = [];
  let lastError: unknown;
  for (let i = 0; i < 90 && !hosts.some((h) => h.address === result.keys.host_address && h.heartbeatMs); i++) {
    try {
      hosts = coordinatorHosts(await reads.read(result.bindingId));
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  report.onlineWaitError = lastError ? String((lastError as Error).message ?? lastError) : null;
  const me = hosts.find((h) => h.address === result.keys.host_address);
  assert.ok(me?.heartbeatMs, "the local Host connects to its own Coordinator");
  report.online = { hostname: me.hostname, system: me.system };
  const verified = await verifyHostObservations(chain, organizationId, result.bindingId, await reads.read(result.bindingId));
  assert.equal(verified[0].state, "verified");
  checks.push("device-authenticated Coordinator read shows this Host online with a verified signed observation");

  // KeepAlive: a killed process comes back.
  process.kill(status.pid!, "SIGKILL");
  let restarted = status;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    restarted = await native.status(hostProfile);
    if (restarted.pid && restarted.pid !== status.pid && restarted.listening) break;
  }
  assert.ok(restarted.pid && restarted.pid !== status.pid && restarted.listening);
  checks.push("launchd restarts a killed envd (KeepAlive)");

  // Stop / start.
  await native.service(hostProfile, "stop");
  const stopped = await native.status(hostProfile);
  assert.equal(stopped.service, "stopped");
  assert.equal(stopped.listening, false);
  await native.service(hostProfile, "start");
  let again = stopped;
  for (let i = 0; i < 40 && !(again.service === "running" && again.listening); i++) {
    await new Promise((r) => setTimeout(r, 500));
    again = await native.status(hostProfile);
  }
  assert.equal(again.service, "running");
  checks.push("stop disables and frees the port; start re-enables and listens again");

  // Re-running setup reconciles without any transaction.
  const calls = nativeCalls.length;
  const txCount = (await admission.directory()).invitations.length;
  await setupLocalHost({ native, chain, admission, deviceProfile: hostProfile, organizationId, hostName: "Acceptance Mac", port, storage });
  assert.equal((await admission.directory()).invitations.length, txCount);
  assert.ok(!nativeCalls.slice(calls).some((c) => c.startsWith("join")));
  checks.push("re-running setup signs and broadcasts nothing new");

  // Revoke + uninstall.
  const member = localMembership(await admission.directory(), result.keys, result.bindingId)!;
  const quote = await admission.prepare({ kind: "revoke-member", targetId: member.id }, randomUUID(), true);
  const revoked = "status" in quote ? quote : await admission.submit(quote);
  transactions.push({ label: "revoke membership (device-signed)", digest: revoked.digest, status: revoked.status, actualGas: revoked.actualGas });
  assert.equal(revoked.status, "confirmed");
  await admission.awaitVisible(revoked);
  await native.uninstall(hostProfile);
  uninstalled = true;
  const gone = await native.status(hostProfile);
  assert.equal(gone.service, "not_installed");
  assert.equal(gone.configured, null);
  assert.ok(!existsSync(plist));
  checks.push("revoke: membership revoked on chain, service removed, configuration removed");
} finally {
  if (!uninstalled) await native.uninstall(hostProfile).catch(() => {});
  helper.stdin!.end();
}
// The key profile itself must be gone from the credential store.
const keysConfig = join(data, "keys.yaml");
await writeFile(keysConfig, `identity:\n  key_profile: "app-${hostProfile}"\n`);
let keyRemoved = false;
try {
  execFileSync(envdBin, ["--config", keysConfig, "--host-public"], { stdio: "pipe" });
} catch (e) {
  keyRemoved = String((e as { stderr?: Buffer }).stderr).includes("not initialized");
}
assert.ok(keyRemoved, "Host key removed from the credential store");
checks.push("Host key removed from the credential store");
report.complete = true;
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ complete: true, checks: checks.length, setupMs: report.setupMs }));
