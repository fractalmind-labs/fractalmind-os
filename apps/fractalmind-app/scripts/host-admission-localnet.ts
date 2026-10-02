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
  signNodeCommand,
  executionBoundaryHash,
  verifyHandoverAcceptanceSignature,
  assertFreshHandoverAcceptance,
  type HandoverProposal,
  type HandoverAcceptance,
  encryptContent,
  recordContext,
  gasCost,
  type SelfPayTransactionOutcome,
  type SelfPayFeeQuote,
  AgentExecutionReadError,
  TransactionPreflightError,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { DeviceIdentityError } from "../src/device-identity";
import { HostAdmission } from "../src/host-admission";
import { ChainReadSession } from "../src/chain";
import { CoordinatorReadClient } from "../src/coordinator-read";
import { coordinatorHosts } from "../src/host-observations";
import { verifyHostObservations } from "../src/host-signatures";
import { AgentImport, managedInstance } from "../src/agent-import";

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
let nativeExecution: unknown;
const journal = new MemoryTransactionJournal();
let nativeCommandSignatures = 0;
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
  if (command === "fm_device_sign_node_command") {
    nativeCommandSignatures++;
    const bytes = fromBase64(args.bytes);
    return {
      bytes: args.bytes,
      signature: toBase64(await deviceKey.sign(bytes)),
    };
  }
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
        nativeExecution,
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
const fixtureContentKey = randomContentKey();
const keyring = new TextEncoder().encode(
  JSON.stringify({
    format: 1,
    contentKey: bytesToHex(fixtureContentKey),
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
type CliHello = {
  host_address: string;
  signing_public_key: string;
  encryption_public_key: string;
  coordinator_public_key?: string;
  coordinator_address?: string;
  coordinator_endpoint?: string;
};
assert.ok(
  !(
    process.env.FM_ENVD_NATIVE_DISCOVERY === "1" &&
    process.env.FM_ENVD_HOST_REJOIN === "1"
  ),
  "native rejoin fixture not yet supported",
);
const liveConnection = process.env.FM_ENVD_CHAIN_CONNECTION === "1";
assert.ok(!liveConnection || process.env.FM_ENVD_JOIN_CLI_BIN);
let envdConnection: unknown;
let envdRejoin: unknown;
assert.ok(
  process.env.FM_ENVD_NATIVE_EXECUTION !== "1" ||
    (process.env.FM_ENVD_NATIVE_DISCOVERY === "1" &&
      process.env.FM_ENVD_AGENT_IMPORT === "1" &&
      process.env.FM_ENVD_HOST_REJOIN !== "1" &&
      process.env.FM_ENVD_AGENT_REBIND !== "1"),
  "native execution requires its independent discovery/import fixture",
);
let beforeHostRevocation:
  | Awaited<ReturnType<CoordinatorReadClient["prepare"]>>
  | undefined;
let deviceHttp: unknown;
let liveReads: CoordinatorReadClient | undefined;
let signedHostSnapshot: unknown;
function startCliHarness() {
  const helper = spawn(
    process.env.FM_ENVD_JOIN_CLI_BIN!,
    ["-test.run=^TestHostJoinLiveCLI$", "-test.v"],
    {
      env: { ...process.env, FM_HOST_JOIN_LIVE_CLI: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "",
    diagnostic = "",
    buffer = "";
  let publicResolve!: (value: CliHello) => void,
    resultResolve!: (value: any) => void,
    connectionResolve!: (value: unknown) => void,
    rejoinReadyResolve!: (value: unknown) => void,
    rejoinResultResolve!: (value: any) => void;
  let publicReject!: (error: Error) => void,
    resultReject!: (error: Error) => void,
    connectionReject!: (error: Error) => void,
    rejoinReadyReject!: (error: Error) => void,
    rejoinResultReject!: (error: Error) => void;
  const publicValue = new Promise<CliHello>((resolve, reject) => {
    publicResolve = resolve;
    publicReject = reject;
  });
  const resultValue = new Promise<any>((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  const connectionValue = new Promise<unknown>((resolve, reject) => {
    connectionResolve = resolve;
    connectionReject = reject;
  });
  const rejoinReadyValue = new Promise<unknown>((resolve, reject) => {
    rejoinReadyResolve = resolve;
    rejoinReadyReject = reject;
  });
  const rejoinResultValue = new Promise<any>((resolve, reject) => {
    rejoinResultResolve = resolve;
    rejoinResultReject = reject;
  });
  const nativePhases = Object.fromEntries(
    ["statusReady", "statusResult", "executeReady", "executeResult"].map(
      (name) => {
        let resolve!: (value: any) => void, reject!: (e: Error) => void;
        const promise = new Promise<any>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        return [name, { resolve, reject, promise }];
      },
    ),
  );
  helper.stdout.on("data", (part) => {
    output += String(part);
    buffer += String(part);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        if (line.startsWith("FM_NATIVE_CONTROL_READY ")) {
          const value = JSON.parse(
            line.slice("FM_NATIVE_CONTROL_READY ".length),
          );
          nativePhases[value.phase + "Ready"].resolve(value);
        }
        if (line.startsWith("FM_NATIVE_CONTROL_RESULT ")) {
          const value = JSON.parse(
            line.slice("FM_NATIVE_CONTROL_RESULT ".length),
          );
          nativePhases[value.phase + "Result"].resolve(value);
        }
        if (line.startsWith("FM_ENVD_HOST_PUBLIC "))
          publicResolve(JSON.parse(line.slice("FM_ENVD_HOST_PUBLIC ".length)));
        if (line.startsWith("FM_HOST_JOIN_CLI_RESULT "))
          resultResolve(
            JSON.parse(line.slice("FM_HOST_JOIN_CLI_RESULT ".length)),
          );
        if (line.startsWith("FM_HOST_REJOIN_READY "))
          rejoinReadyResolve(
            JSON.parse(line.slice("FM_HOST_REJOIN_READY ".length)),
          );
        if (line.startsWith("FM_HOST_REJOIN_RESULT "))
          rejoinResultResolve(
            JSON.parse(line.slice("FM_HOST_REJOIN_RESULT ".length)),
          );
        if (line.startsWith("FM_CHAIN_CONNECTION_RESULT "))
          connectionResolve(
            JSON.parse(line.slice("FM_CHAIN_CONNECTION_RESULT ".length)),
          );
      } catch (error) {
        publicReject(error as Error);
        resultReject(error as Error);
        connectionReject(error as Error);
        rejoinReadyReject(error as Error);
        rejoinResultReject(error as Error);
        for (const phase of Object.values(nativePhases))
          phase.reject(error as Error);
      }
    }
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
            new Error(`envd fixture failed (${code}): ${output} ${diagnostic}`),
          ),
    );
  });
  const ended = done.then(() => {
    throw new Error("envd exited before requested public result");
  });
  // Install termination observers for all phases immediately; no orphaned
  // promise rejection while the fixture waits for a later public chain action.
  const publicReady = Promise.race([publicValue, ended]);
  const resultReady = Promise.race([resultValue, ended]);
  const connectionReady = Promise.race([connectionValue, ended]);
  void publicReady.catch(() => {});
  void resultReady.catch(() => {});
  void connectionReady.catch(() => {});
  const rejoinReady = Promise.race([rejoinReadyValue, ended]),
    rejoinResult = Promise.race([rejoinResultValue, ended]);
  void rejoinReady.catch(() => {});
  void rejoinResult.catch(() => {});
  for (const phase of Object.values(nativePhases)) {
    phase.promise = Promise.race([phase.promise, ended]);
    void phase.promise.catch(() => {});
  }
  helper.stdin.write(
    JSON.stringify({
      PackageID: deployment.packageId,
      RegistryID: deployment.registryId,
      OrganizationID: organizationId,
      ChainIdentifier: deployment.chain.chainIdentifier,
      JournalRoot: `${process.argv[3]}.journal`,
      LiveConnection: liveConnection,
    }) + "\n",
  );
  return {
    helper,
    publicReady,
    resultReady,
    connectionReady,
    rejoinReady,
    rejoinResult,
    nativePhases,
    done,
  };
}
const earlyHarness = liveConnection ? startCliHarness() : undefined;
const earlyPublic = earlyHarness ? await earlyHarness.publicReady : undefined;
const coordinatorPublic =
  earlyPublic?.coordinator_public_key ??
  bytesToHex(coordinator.getPublicKey().toRawBytes());
const coordinatorAddress =
  earlyPublic?.coordinator_address ?? coordinator.toSuiAddress();
const coordinatorEndpoint =
  earlyPublic?.coordinator_endpoint ?? "http://127.0.0.1:19090";
const bindingAttempt = randomUUID();
const bindingQuote = await controller.prepare(
  {
    kind: "binding",
    endpoint: coordinatorEndpoint,
    publicKey: coordinatorPublic,
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
  coordinatorAddress,
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
let envdCli: unknown;
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
  const nativePhases = Object.fromEntries(
    ["statusReady", "statusResult", "executeReady", "executeResult"].map(
      (name) => {
        let resolve!: (value: any) => void, reject!: (e: Error) => void;
        const promise = new Promise<any>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        return [name, { resolve, reject, promise }];
      },
    ),
  );
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
let joined: SelfPayTransactionOutcome;
if (process.env.FM_ENVD_JOIN_CLI_BIN) {
  const harness = earlyHarness ?? startCliHarness();
  const ready = await harness.publicReady;
  await requestSuiFromFaucetV2({ host: faucet, recipient: ready.host_address });
  const credentialInput = `${first.code}\nJOIN ${organizationId}\n`;
  if (liveConnection) harness.helper.stdin.write(credentialInput);
  else harness.helper.stdin.end(credentialInput);
  const recovered = await harness.resultReady;
  if (!liveConnection) await harness.done;
  assert.equal(recovered.broadcasts, 1);
  assert.equal(recovered.result.state, "confirmed");
  assert.equal(recovered.result.membership.current_membership, true);
  envdCli = {
    ...recovered,
    hostAddress: ready.host_address,
    journalRoot: `${process.argv[3]}.journal`,
  };
  const lookup = await coreClient.core.getTransaction({
    digest: recovered.result.digest,
    include: {
      effects: true,
      objectTypes: true,
      events: true,
      balanceChanges: true,
      transaction: true,
    },
  });
  assert.equal(lookup.$kind, "Transaction");
  assert.equal(lookup.Transaction.status.success, true);
  joined = {
    status: "confirmed",
    digest: recovered.result.digest,
    requestId: "go-envd-cli-fixture",
    actualGas: recovered.result.actual_fee_mist,
    journalSynced: true,
    transaction: lookup.Transaction,
  };
  await record(
    "Go envd CLI redeems App invitation; injected response loss recovered by original query",
    joined,
  );
  await visible(joined);
  checks.push(
    "production CLI pipeline confirms organization and fees, signs once with generated Go Host keys, persists original digest, recovers lost receipt and supports public query without keys; OS/TTY/cloud not verified",
  );
} else {
  assert.ok(first.code);
  const redemption = await sdk.host.prepareJoin({
    code: first.code,
    network: "localnet",
    hostPublicKey: host.getPublicKey().toRawBytes(),
    encryptionPublicKey: hostEncryption.publicKey,
    name: "fixture Host (not deployed envd)",
  });
  joined = await execute(
    "SDK fixture Host redeems App invitation",
    redemption.transaction,
    host,
  );
}
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
if (earlyHarness && earlyPublic) {
  liveReads = new CoordinatorReadClient(
    new ChainReadSession(profile),
    device,
    grantId,
    organizationId,
  );
  assert.equal(
    (await fetch(coordinatorEndpoint + "/api/sentinels")).status,
    403,
  );
  assert.equal(
    (
      await fetch(coordinatorEndpoint + "/api/sentinels", {
        headers: { Authorization: "Bearer legacy-token" },
      })
    ).status,
    403,
  );
  let observed: any;
  for (let attempt = 0; attempt < 20; attempt++) {
    observed = await liveReads.read(
      bindingId,
      `/api/sentinels/${earlyPublic.host_address}`,
    );
    if (observed.last_heartbeat) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(observed.host_id, earlyPublic.host_address);
  assert.ok(observed.last_heartbeat);
  assert.ok(observed.system.num_cpu > 0);
  const displayed = coordinatorHosts(await liveReads.read(bindingId));
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].address, earlyPublic.host_address);
  assert.equal(displayed[0].system?.cpu, observed.system.num_cpu);
  signedHostSnapshot = await liveReads.read(bindingId);
  const independent = await verifyHostObservations(
    new ChainReadSession(profile),
    organizationId,
    bindingId,
    signedHostSnapshot,
  );
  assert.equal(independent[0].state, "verified");
  assert.equal(independent[0].observation?.address, earlyPublic.host_address);
  assert.equal(
    independent[0].observation?.system?.cpu,
    observed.system.num_cpu,
  );
  assert.ok(independent[0].freshUntilMs! > Date.now());
  const changedBody = structuredClone(signedHostSnapshot) as any;
  changedBody.sentinels[0].host_observation.body = toBase64(
    new TextEncoder().encode('{"forged":true}'),
  );
  const rejected = await verifyHostObservations(
    new ChainReadSession(profile),
    organizationId,
    bindingId,
    changedBody,
  );
  assert.equal(rejected[0].state, "unknown");
  assert.equal(rejected[0].observation, null);
  const honest = await liveReads.readHosts(bindingId);
  assert.equal(honest[0].state, "verified");
  if (process.env.FM_ENVD_AGENT_DISCOVERY === "1") {
    const nativeDiscovery = process.env.FM_ENVD_NATIVE_DISCOVERY === "1";
    const scan = nativeDiscovery
      ? honest[0].nativeDiscovery
      : honest[0].discovery;
    assert.equal(scan?.state, "complete");
    assert.equal(scan?.instances.length, 1);
    assert.equal(
      scan?.instances[0].session,
      nativeDiscovery ? "native-files" : "agent-chain-existing",
    );
    assert.equal(scan?.instances[0].state, "observed");
    assert.equal(
      scan?.instances[0].runtime,
      nativeDiscovery ? "bounded-process-v1" : "tmux-observe",
    );
    assert.equal(
      scan?.instances[0].continuity,
      nativeDiscovery ? "envd-process-v1" : "kernel-process-v1",
    );
    assert.match(
      scan!.instances[0].instanceId,
      nativeDiscovery ? /^native-[0-9a-f]{64}$/ : /^tmux-[0-9a-f]{64}$/,
    );
    assert.ok(scan!.freshUntilMs! > Date.now());
    checks.push(
      nativeDiscovery
        ? "Actual instantiated native file adapter and envd kernel birth identity traverse Host signature, authenticated Coordinator read and App discovery verification; workspace binding is canonical, import remains observation-only"
        : "Actual isolated tmux pane and native kernel birth identity traverse Host signature, authenticated Coordinator read and App discovery verification; observation-only capabilities and independent scan deadline preserved",
    );
    if (process.env.FM_ENVD_AGENT_IMPORT === "1") {
      const chain = new ChainReadSession(profile);
      const importer = new AgentImport(
        chain,
        device,
        grantId,
        organizationId,
        journal,
      );
      const selected = {
        bindingId,
        hostAddress: earlyPublic.host_address,
        instanceId: scan!.instances[0].instanceId,
        workspaceHash: scan!.instances[0].workspaceHash,
      };
      assert.equal(
        await managedInstance(
          chain,
          organizationId,
          selected.hostAddress,
          selected.instanceId,
        ),
        null,
      );
      const attemptId = randomUUID(),
        quote = await importer.prepare(selected, attemptId, true);
      assert.ok(!("status" in quote));
      // Lose only the real execution response. Authority, signing, simulation,
      // durable digest and subsequent ledger reads use production code.
      let importBroadcasts = 0;
      let loseInitialQuery = false;
      const options = (importer.manager as any).options,
        originalClient = options.client;
      const coreProxy = new Proxy(originalClient.core, {
        get(target, property) {
          if (property === "executeTransaction")
            return async (input: unknown) => {
              importBroadcasts++;
              await target.executeTransaction(input);
              loseInitialQuery = true;
              throw new Error("injected lost import response");
            };
          if (property === "getTransaction")
            return async (input: unknown) => {
              if (loseInitialQuery) {
                loseInitialQuery = false;
                throw new Error(
                  "injected unavailable first import receipt query",
                );
              }
              return target.getTransaction(input);
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      options.client = new Proxy(originalClient, {
        get(target, property) {
          if (property === "core") return coreProxy;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const lost = await importer.submit(quote);
      assert.ok(lost.status !== "already-imported");
      assert.equal(lost.status, "unknown");
      importer.dispose();
      const restarted = new AgentImport(
        new ChainReadSession(profile),
        device,
        grantId,
        organizationId,
        journal,
      );
      let recovered: SelfPayTransactionOutcome | undefined;
      for (let n = 0; n < 40; n++) {
        recovered = await restarted.query(attemptId);
        if (recovered?.status === "confirmed") break;
        await new Promise((resolve) => setTimeout(resolve, 125));
      }
      assert.equal(recovered?.digest, lost.digest);
      assert.equal(recovered?.status, "confirmed");
      await record(
        "App observation-only Agent import; lost response recovered by original digest",
        recovered!,
      );
      const imported = await restarted.confirmed(recovered!);
      assert.equal(imported.instance_id, selected.instanceId);
      assert.equal(imported.control_confirmed, false);
      assert.equal(imported.runtime, scan!.instances[0].runtime);
      // Exercise the contract's idempotent receipt directly. Normal App
      // duplicate handling below sends no transaction and pays no new fee.
      const duplicateManager = new SelfPayTransactionManager({
        client: coreClient,
        network: "localnet",
        signer: device,
        journal,
      });
      const duplicateQuote = await duplicateManager.prepare({
        requestId: `agent-import-race:${randomUUID()}`,
        transaction: sdk.host.importAgent({
          organizationId,
          humanId,
          grantId,
          membershipId,
          bindingId,
          instanceId: selected.instanceId,
          runtime: scan!.instances[0].runtime,
          workspaceHash: Uint8Array.from(
            selected.workspaceHash.match(/../g)!,
            (x) => parseInt(x, 16),
          ),
          controlConfirmed: false,
        }),
        gasBudget: 200000000n,
      });
      let duplicateOutcome = await duplicateManager.submit(duplicateQuote);
      for (let n = 0; n < 40 && duplicateOutcome.status === "unknown"; n++) {
        await new Promise((resolve) => setTimeout(resolve, 125));
        duplicateOutcome = (await duplicateManager.query(
          duplicateQuote.requestId,
        ))!;
      }
      await record(
        "Deliberate contract duplicate receipt; App normal duplicates remain fee-free",
        duplicateOutcome,
      );
      assert.equal(
        (await restarted.confirmed(duplicateOutcome)).id,
        imported.id,
      );
      const duplicate = await restarted.prepare(selected, randomUUID(), true);
      assert.ok(
        "status" in duplicate && duplicate.status === "already-imported",
      );
      assert.equal(duplicate.record.id, imported.id);
      assert.equal(importBroadcasts, 1);
      assert.equal(
        (
          await managedInstance(
            new ChainReadSession(profile),
            organizationId,
            selected.hostAddress,
            selected.instanceId,
          )
        )?.id,
        imported.id,
      );
      if (process.env.FM_ENVD_NATIVE_EXECUTION === "1") {
        assert.ok(nativeDiscovery);
        const authority = {
          organizationId,
          humanId,
          grantId,
          membershipId,
          bindingId,
          managedAgentId: imported.id,
        };
        const beforeCap = created(
          await execute(
            "Native state: issue read-only status authority before control fixture",
            sdk.host.issueCapability({
              ...authority,
              actions: ["status"],
              scope: "observation",
              maxUses: 1n,
              expiresAtMs: Date.now() + 300000,
            }),
          ),
          "remote_authority::RemoteCapability",
        );
        const target = {
          organizationId,
          nodeId: earlyPublic.host_address,
          agentId: selected.instanceId,
        };
        const before = await signNodeCommand(device, {
          target,
          action: "status",
          scope: "observation",
          capability: { id: beforeCap, revocationVersion: 1n },
          payload: {},
          expiresAtMs: Date.now() + 120000,
        });
        const prepare = async (label: string, command: any) =>
          created(
            await execute(
              label,
              await sdk.nodeExecution.prepareCommand({
                ...authority,
                command,
                resultKey: {
                  organizationKey: fixtureContentKey,
                  keyVersion: 1n,
                },
              }),
            ),
            "node_execution::CommandExecution",
          );
        // Object writes and indexed dynamic-field pagination become visible
        // separately. Retry only reads of the same instance; never its write.
        const readHistory = async () => {
          const deadline = Date.now() + 20000;
          while (true) {
            try {
              return await sdk.nodeExecution.readAgentExecutions(
                organizationId,
                imported.id,
              );
            } catch (e) {
              if (
                !(e instanceof AgentExecutionReadError) ||
                Date.now() >= deadline
              )
                throw e;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        };
        const beforeExecution = await prepare(
          "Native state: prepare current read-only status checkpoint",
          before,
        );
        let statusTransport: unknown;
        if (process.env.FM_ENVD_DEVICE_COMMAND === "1") {
          assert.ok(liveReads);
          nativeExecution = {
            instanceId: selected.instanceId,
            recordId: imported.id,
            organizationId,
            beforeExecution,
            phase: "device_status_transport_prepared",
            safeAppHandoverVerified: false,
            osStoreVerified: false,
          };
          await save();
          const prepared = await liveReads.prepareCommand(bindingId, before);
          const response = (await prepared.send()) as any;
          assert.equal(response.success, true);
          assert.equal(response.response.ok, true);
          assert.equal(response.response.result.physical_state, "idle");
          assert.equal(response.response.execution_id, beforeExecution);
          assert.equal(
            (await sdk.nodeExecution.getExecution(beforeExecution)).state,
            2,
          );
          await assert.rejects(prepared.send(), /read_already_used/);
          statusTransport = {
            nativeBridgeInjected: true,
            osStoreVerified: false,
            actualCoordinatorHttp: true,
            actualAuthenticatedWorker: true,
            scope: "observation",
            executionId: beforeExecution,
            originalDigest: response.response.transaction_digest,
            replayRejectedBeforeSecondHttp: true,
          };
          checks.push(
            "NativeDeviceSigner and explicit one-use body-bound command transport dispatch status through the real chain Coordinator and authenticated envd; original chain result confirmed before inspecting duplicate",
          );
        }
        earlyHarness.helper.stdin.write("STATUS\n");
        await earlyHarness.nativePhases.statusReady.promise;
        earlyHarness.helper.stdin.write(
          JSON.stringify({ Command: before }) + "\n",
        );
        const status = await earlyHarness.nativePhases.statusResult.promise;
        assert.equal(status.response.ok, true);
        assert.equal(status.response.result.physical_state, "idle");
        assert.equal(status.response.result.instance_id, selected.instanceId);
        if (statusTransport) {
          assert.equal(status.device_command_dispatches, 1);
          assert.equal(status.response.duplicate, true);
        }
        assert.equal(
          (await sdk.host.getManagedAgent(imported.id)).control_confirmed,
          false,
        );
        const hostResult = async (
          label: string,
          response: any,
          observationId?: string,
        ) => {
          const digest = response.transaction_digest;
          assert.ok(digest);
          transactions.push({
            label,
            digest,
            phase: "original_host_digest_received",
          });
          await save();
          const run = await sdk.nodeExecution.getExecution(
            response.execution_id,
          );
          assert.equal(run.state, 2);
          assert.equal(run.agent_id, selected.instanceId);
          assert.ok(run.result_record);
          const resultId = observationId ?? run.result_record;
          const { object } = await coreClient.core.getObject({
            objectId: resultId,
            include: { previousTransaction: true },
          });
          assert.equal(object.owner.$kind, "Immutable");
          assert.equal(
            object.type,
            `${deployment.packageId}::${observationId ? "okr::Observation" : "product_record::EncryptedRecord"}`,
          );
          assert.equal(object.previousTransaction, digest);
          let receipt;
          try {
            receipt = await coreClient.core.getTransaction({
              digest,
              include: {
                effects: true,
                objectTypes: true,
                events: true,
                balanceChanges: true,
                transaction: true,
              },
            });
          } catch (error) {
            // Tiny localnet retention can prune a transaction while the Host
            // confirms its exact result object. Do not replay or invent a fee.
            if ((error as { reason?: string }).reason !== "notFound")
              throw error;
            transactions.push({
              label,
              digest,
              status: "immutable_effect_confirmed",
              immutableObjectId: resultId,
              actualGas: null,
              feeState: "original_transaction_unavailable",
            });
            await save();
            return;
          }
          assert.equal(receipt.$kind, "Transaction");
          assert.equal(receipt.Transaction!.status.success, true);
          await record(label, {
            status: "confirmed",
            requestId: "native-host:" + response.command_id,
            digest,
            actualGas: gasCost(receipt.Transaction!.effects.gasUsed),
            journalSynced: true,
            transaction: receipt.Transaction!,
          });
        };
        await hostResult(
          "Native state: Host confirms encrypted physical idle evidence",
          status.response,
        );
        const initialHistory = await readHistory();
        assert.equal(initialHistory.unsettledControl, 0);
        assert.equal(initialHistory.executions.length, 1);
        assert.equal(initialHistory.executions[0].settled, true);
        assert.equal(initialHistory.executions[0].control, false);
        // This explicit raw control grant is a fixture for the already installed
        // execution engine. It is not App handover or evidence of safe adoption.
        await execute(
          "Native alias execution fixture: explicitly set controlled test registration",
          sdk.host.rebindAgent({
            ...authority,
            expectedVersion: 1n,
            runtime: "bounded-process-v1",
            workspaceHash: Uint8Array.from(imported.workspace_hash),
            controlConfirmed: true,
          }),
        );
        const logicalId = randomUUID(),
          paths = { "file.read": ["."], "file.write": ["."] };
        const files = [
          {
            path: "FIRST.md",
            content: "Native alias attained the first bounded file goal\n",
          },
          {
            path: "SECOND.md",
            content: "Native alias attained the second bounded file goal\n",
          },
        ];
        const spec = await encryptContent(
          new TextEncoder().encode(
            JSON.stringify({
              format: 1,
              objective:
                "Two actual text-file goals on the discovered native instance",
              successCriteria: ["Both measured hashes match"],
            }),
          ),
          fixtureContentKey,
          recordContext(organizationId, "okr", `okr-${logicalId}-spec`, 1n, 1n),
        );
        const draft = created(
          await execute(
            "Native alias: create one measurable OKR",
            sdk.okr.createDraft({
              organizationId,
              humanId,
              grantId,
              logicalId,
              priority: 0,
              deadlineMs: Date.now() + 300000,
              baselines: [0n],
              targets: [2n],
              weights: [1n],
              maxAgesMs: [60000n],
              keyVersion: 1n,
              encryptedBody: spec,
            }),
          ),
          "okr::Okr",
        );
        const boundaryHash = executionBoundaryHash(paths);
        const agreement = await encryptContent(
          new TextEncoder().encode(
            JSON.stringify({
              format: 1,
              managedAgentId: imported.id,
              boundaryHash: Array.from(boundaryHash),
              budget: { asset: "TOOL_CALLS", limit: "6" },
              nativeFilePlan: {
                format: 1,
                paths,
                krs: [{ files, maxCalls: "6" }],
              },
            }),
          ),
          fixtureContentKey,
          recordContext(
            organizationId,
            "contract",
            `okr-${logicalId}-agreement`,
            1n,
            1n,
          ),
        );
        await execute(
          "Native alias: explicitly authorize bounded ACTIVE OKR fixture",
          sdk.okr.activate({
            ...authority,
            okrId: draft,
            expectedVersion: 1n,
            workspaceHash: Uint8Array.from(imported.workspace_hash),
            boundaryHash,
            budgetAsset: "TOOL_CALLS",
            budgetLimit: 6n,
            expiresAtMs: Date.now() + 180000,
            expectedRecordRevision: 0n,
            keyVersion: 1n,
            encryptedBody: agreement,
          }),
        );
        const capId = created(
          await execute(
            "Native alias: issue current OKR authority",
            sdk.okr.issueCapability({
              ...authority,
              okrId: draft,
              expectedVersion: 2n,
              maxUses: 1n,
            }),
          ),
          "remote_authority::RemoteCapability",
        );
        const command = await signNodeCommand(device, {
          target,
          action: "assign",
          scope: "control",
          capability: { id: capId, revocationVersion: 1n },
          budget: { asset: "TOOL_CALLS", amount: 6n },
          payload: {
            task: JSON.stringify({ kind: "ensure_text_files", files }),
            bounds: { paths, max_calls: "6" },
            okr: { id: draft, agreement_version: "1", kr_index: "0" },
            measurement: { kind: "verified_text_file_count" },
          },
          expiresAtMs: Number((await sdk.okr.getOkr(draft)).expires_at_ms) - 1,
        });
        const executionId = await prepare(
          "Native alias: reserve the explicitly authorized command and result key",
          command,
        );
        nativeExecution = {
          phase: "queued_coverage_read",
          organizationId,
          humanId,
          recordId: imported.id,
          executionId,
          beforeExecution,
        };
        await save();
        const queuedHistory = await readHistory();
        assert.equal(queuedHistory.unsettledControl, 1);
        const queued = queuedHistory.executions.find(
          (x) => x.run.id === executionId,
        )!;
        assert.equal(queued.run.state, 0);
        assert.equal(queued.reserved, 6n);
        let queuedMoveAbortVerified = false;
        const negativeCore = new Proxy(coreClient.core, {
          get(target, property) {
            if (property === "simulateTransaction")
              return async (
                input: Parameters<typeof target.simulateTransaction>[0],
              ) => {
                const result = await target.simulateTransaction(input);
                const receipt =
                  result.$kind === "Transaction"
                    ? result.Transaction
                    : result.FailedTransaction;
                assert.equal(receipt.status.success, false);
                assert.match(JSON.stringify(receipt.status.error), /9210/);
                queuedMoveAbortVerified = true;
                return result;
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const negativeManager = new SelfPayTransactionManager({
          client: new Proxy(coreClient, {
            get(target, property) {
              if (property === "core") return negativeCore;
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
          network: "localnet",
          signer: deviceKey,
          journal,
        });
        await assert.rejects(
          negativeManager.prepare({
            requestId: `fixture:queued-handover:${randomUUID()}`,
            gasBudget: 200000000n,
            transaction: sdk.host.rebindAgent({
              ...authority,
              expectedVersion: 2n,
              runtime: "bounded-process-v1",
              workspaceHash: Uint8Array.from(imported.workspace_hash),
              controlConfirmed: true,
            }),
          }),
          (e) =>
            e instanceof TransactionPreflightError &&
            e.code === "simulation_failed",
        );
        assert.equal(queuedMoveAbortVerified, true);
        await execute(
          "Execution coverage: identical preparation does not add a second execution",
          await sdk.nodeExecution.prepareCommand({ ...authority, command }),
        );
        const duplicateHistory = await readHistory();
        assert.equal(duplicateHistory.revision, queuedHistory.revision);
        assert.equal(duplicateHistory.executions.length, 2);
        assert.equal(duplicateHistory.unsettledControl, 1);
        checks.push(
          "Actual chain preflight rejects Agent rebind with Move 9210 while a control is queued; duplicate preparation keeps one entry and one reservation",
        );
        const afterCap = created(
          await execute(
            "Native state: issue fresh status authority for current managed version",
            sdk.host.issueCapability({
              ...authority,
              actions: ["status"],
              scope: "observation",
              maxUses: 1n,
              expiresAtMs: Date.now() + 300000,
            }),
          ),
          "remote_authority::RemoteCapability",
        );
        const after = await signNodeCommand(device, {
          target,
          action: "status",
          scope: "observation",
          capability: { id: afterCap, revocationVersion: 1n },
          payload: {},
          expiresAtMs: Date.now() + 120000,
        });
        const afterExecution = await prepare(
          "Native state: reserve post-execution status checkpoint",
          after,
        );
        nativeExecution = {
          instanceId: selected.instanceId,
          recordId: imported.id,
          okrId: draft,
          executionId,
          beforeExecution,
          afterExecution,
          phase: "commands_prepared",
          controlSetupFixtureOnly: true,
          safeAppHandoverVerified: false,
        };
        await save();
        earlyHarness.helper.stdin.write("EXECUTE\n");
        await earlyHarness.nativePhases.executeReady.promise;
        earlyHarness.helper.stdin.write(
          JSON.stringify({ Command: command, After: after }) + "\n",
        );
        const attained = await earlyHarness.nativePhases.executeResult.promise;
        assert.equal(attained.actual_workspace_writes, true);
        assert.equal(attained.factory_rebuild_duplicate, true);
        assert.equal(attained.response.spend.amount, "6");
        assert.equal(attained.after.result.physical_state, "idle");
        await hostResult(
          "Native alias: original Host execution result confirmed",
          attained.response,
        );
        const observations = (await sdk.okr.listObservations(draft))
          .observations;
        assert.equal(observations.length, 1);
        assert.equal(observations[0].run_id, executionId);
        assert.equal(observations[0].current, "2");
        await hostResult(
          "Native alias: original Host measurement confirmed",
          {
            ...attained.response,
            transaction_digest:
              attained.response.okr_observation.transaction_digest,
            command_id: "measurement",
          },
          observations[0].id,
        );
        await hostResult(
          "Native state: original Host post-execution status confirmed",
          attained.after,
        );
        const okr = await sdk.okr.getOkr(draft);
        assert.equal(okr.metrics[0].current, "2");
        assert.equal(okr.metrics[0].verified, false);
        assert.equal(okr.state, 1);
        const { asset, spent, reserved } = await sdk.okr.getBudget(draft);
        assert.deepEqual(
          { asset, spent, reserved },
          {
            asset: "TOOL_CALLS",
            spent: 6n,
            reserved: 0n,
          },
        );
        assert.equal(
          (await sdk.nodeExecution.getExecution(executionId)).state,
          2,
        );
        assert.equal(
          (await sdk.remoteAuthority.getCapability(capId)).usesClaimed,
          1n,
        );
        const settledHistory = await readHistory();
        assert.equal(settledHistory.unsettledControl, 0);
        assert.equal(settledHistory.executions.length, 3);
        assert.ok(
          settledHistory.executions.every(
            (x) => x.settled && x.reserved === 0n,
          ),
        );
        assert.equal(
          settledHistory.executions.find((x) => x.run.id === executionId)!
            .spent,
          6n,
        );
        const cancelCap = created(
          await execute(
            "Execution coverage: issue separate control for queued cancellation",
            sdk.host.issueCapability({
              ...authority,
              actions: ["assign"],
              scope: "control",
              maxUses: 1n,
              budgetAsset: "TOOL_CALLS",
              maxBudget: 3n,
              expiresAtMs: Date.now() + 120000,
            }),
          ),
          "remote_authority::RemoteCapability",
        );
        const cancelCommand = await signNodeCommand(device, {
          target,
          action: "assign",
          scope: "control",
          capability: { id: cancelCap, revocationVersion: 1n },
          budget: { asset: "TOOL_CALLS", amount: 3n },
          payload: {
            task: "Protocol-only queued cancellation fixture; never dispatch",
            bounds: { paths, max_calls: "3" },
          },
          expiresAtMs: Date.now() + 60000,
        });
        const cancelId = await prepare(
          "Execution coverage: prepare cancellation fixture without dispatch",
          cancelCommand,
        );
        assert.equal((await readHistory()).unsettledControl, 1);
        await execute(
          "Execution coverage: cancel queued command and release its reservation atomically",
          sdk.nodeExecution.requestStop({
            organizationId,
            humanId,
            grantId,
            capabilityId: cancelCap,
            executionId: cancelId,
          }),
        );
        const finalHistory = await readHistory();
        assert.equal(finalHistory.unsettledControl, 0);
        const cancelled = finalHistory.executions.find(
          (x) => x.run.id === cancelId,
        )!;
        assert.equal(cancelled.run.state, 5);
        assert.equal(cancelled.settled, true);
        assert.equal(cancelled.spent, 0n);
        assert.equal(cancelled.reserved, 0n);
        checks.push(
          "Complete instance history covers four executions across independent capabilities; real Host settlement clears control once and queued cancellation clears reservation without dispatch",
        );
        nativeExecution = {
          instanceId: selected.instanceId,
          recordId: imported.id,
          okrId: draft,
          executionId,
          beforeExecution,
          afterExecution,
          physicalIdleBefore: true,
          physicalIdleAfter: true,
          actualWorkspaceWrites: true,
          toolCallsSpent: 6,
          originalResultDigest: attained.response.transaction_digest,
          measurementDigest:
            attained.response.okr_observation.transaction_digest,
          duplicateOriginalDigest: attained.duplicate_digest,
          productionFactory: true,
          factoryRebuiltInSameProcess: true,
          statusTransport,
          nativeCommandSignatures,
          controlSetupFixtureOnly: true,
          safeAppHandoverVerified: false,
          humanAcceptanceVerified: false,
          executionCoverage: {
            revision: finalHistory.revision,
            entries: finalHistory.executions.length,
            unsettledControl: finalHistory.unsettledControl,
            queuedRebindMoveAbort: 9210,
            duplicatePreparationCountedOnce: true,
            queuedCancellationId: cancelId,
          },
        };
        checks.push(
          "Read-only signed native status before control returns actual physical idle and encrypted chain result; it does not grant control",
        );
        checks.push(
          "Same discovered native alias executes six actual bounded file tools under an ACTIVE OKR; real Host measurement reaches two while human verification remains pending",
        );
        checks.push(
          "Factory rebuild in the same process reconstructs original result without re-execution; fresh signed status proves physical idle after tool handles close",
        );
        if (process.env.FM_ENVD_HANDOVER_REVIEW === "1") {
          assert.ok(liveReads);
          const reviewLogical = randomUUID();
          const reviewSpec = await encryptContent(
            new TextEncoder().encode(
              JSON.stringify({
                format: 1,
                objective:
                  "Review a bounded file agreement without starting tools",
                successCriteria: [
                  "Host accepts exact constraints; no file changes",
                ],
              }),
            ),
            fixtureContentKey,
            recordContext(
              organizationId,
              "okr",
              `okr-${reviewLogical}-spec`,
              1n,
              1n,
            ),
          );
          const reviewOkr = created(
            await execute(
              "Handover review: create encrypted draft without activation",
              sdk.okr.createDraft({
                organizationId,
                humanId,
                grantId,
                logicalId: reviewLogical,
                priority: 0,
                deadlineMs: Date.now() + 300000,
                baselines: [0n],
                targets: [1n],
                weights: [1n],
                maxAgesMs: [60000n],
                keyVersion: 1n,
                encryptedBody: reviewSpec,
              }),
            ),
            "okr::Okr",
          );
          const reviewCap = created(
            await execute(
              "Handover review: issue observation capability for exact current native registration",
              sdk.host.issueCapability({
                ...authority,
                actions: ["status"],
                scope: "observation",
                maxUses: 1n,
                expiresAtMs: Date.now() + 180000,
              }),
            ),
            "remote_authority::RemoteCapability",
          );
          const managedBefore = await sdk.host.getManagedAgent(imported.id);
          const draftBefore = await sdk.okr.getOkr(reviewOkr);
          const proposal: HandoverProposal = {
            version: "1",
            managed_agent_id: imported.id,
            managed_version: managedBefore.version,
            okr_id: reviewOkr,
            okr_version: draftBefore.version,
            spec_revision: draftBefore.spec_revision,
            workspace_hash: bytesToHex(
              Uint8Array.from(managedBefore.workspace_hash),
            ),
            paths,
            budget_asset: "TOOL_CALLS",
            budget_limit: "10",
            max_calls: "3",
            expires_at_ms: Date.now() + 120000,
            review_expires_at_ms: Date.now() + 45000,
            nonce:
              randomUUID().replaceAll("-", "") +
              randomUUID().replaceAll("-", ""),
          };
          const reviewCommand = await signNodeCommand(device, {
            target,
            action: "status",
            scope: "observation",
            capability: { id: reviewCap, revocationVersion: 1n },
            payload: { handover_review: proposal },
            expiresAtMs: Date.now() + 120000,
          });
          const reviewExecution = await prepare(
            "Handover review: prepare signed status with encrypted result recipient",
            reviewCommand,
          );
          nativeExecution = {
            ...(nativeExecution as Record<string, unknown>),
            handoverReview: {
              phase: "prepared",
              executionId: reviewExecution,
              okrId: reviewOkr,
              proposal,
              safeAppHandoverVerified: false,
            },
          };
          await save();
          const prepared = await liveReads.prepareCommand(
            bindingId,
            reviewCommand,
          );
          const response = (await prepared.send()) as any;
          assert.equal(response.success, true);
          assert.equal(response.response.ok, true);
          const acceptance = response.response
            .handover_review as HandoverAcceptance;
          assert.ok(acceptance);
          assert.equal(acceptance.execution_id, reviewExecution);
          assert.equal(response.response.result.physical_state, "idle");
          assert.equal(response.response.result.review_pending, true);
          await verifyHandoverAcceptanceSignature(
            acceptance,
            earlyPublic.host_address,
          );
          const clock = await sdk.client.getMoveObject("0x6");
          assertFreshHandoverAcceptance(
            acceptance,
            Number(clock.fields.timestamp_ms),
            proposal,
          );
          const reviewRun =
            await sdk.nodeExecution.getExecution(reviewExecution);
          assert.equal(reviewRun.state, 2);
          assert.ok(reviewRun.result_record);
          const decrypted = await sdk.productRecord.decryptRecord(
            reviewRun.result_record,
            fixtureContentKey,
          );
          const persisted = JSON.parse(
            new TextDecoder().decode(decrypted.plaintext),
          );
          decrypted.plaintext.fill(0);
          assert.deepEqual(persisted.response.handover_review, acceptance);
          await verifyHandoverAcceptanceSignature(
            persisted.response.handover_review,
            earlyPublic.host_address,
          );
          const history = await readHistory();
          assert.equal(history.unsettledControl, 0);
          assert.equal(
            BigInt(history.revision),
            BigInt(acceptance.coverage_revision) + 1n,
          );
          assert.equal((await sdk.okr.getOkr(reviewOkr)).state, 0);
          assert.equal(
            (await sdk.host.getManagedAgent(imported.id)).version,
            managedBefore.version,
          );
          await hostResult(
            "Handover review: original encrypted Host acceptance confirmed",
            response.response,
          );
          await assert.rejects(prepared.send(), /read_already_used/);
          nativeExecution = {
            ...(nativeExecution as Record<string, unknown>),
            handoverReview: {
              phase: "confirmed",
              executionId: reviewExecution,
              okrId: reviewOkr,
              proposal,
              acceptance,
              originalDigest: response.response.transaction_digest,
              persistedEncryptedProofVerified: true,
              actualCoordinatorHttp: true,
              actualTypedChainInspection: true,
              physicalIdleHeld: true,
              reviewCoverageRevision: acceptance.coverage_revision,
              settledCoverageRevision: history.revision,
              draftRemainedInactive: true,
              managedVersionUnchanged: true,
              safeAppHandoverVerified: false,
              osStoreVerified: false,
              requiresExplicitChainApprovalAndContinue: true,
            },
          };
          checks.push(
            "Real signed status review checks exact live Sui authority, full zero-unsettled coverage and physical roots, holds native slot without tools, and persists an independently verified Host proof encrypted on Sui; draft stays inactive",
          );
          checks.push(
            "Review publication increments coverage exactly once; SDK decrypts original immutable evidence and verifies Host signature and original expiry; duplicate send is denied before a second HTTP dispatch",
          );
          await save();
        }
      }
      if (process.env.FM_ENVD_AGENT_REBIND === "1") {
        const rebindParameters = {
          organizationId,
          humanId,
          grantId,
          membershipId,
          bindingId,
          managedAgentId: imported.id,
          runtime: scan!.instances[0].runtime,
          workspaceHash: Uint8Array.from(
            selected.workspaceHash.match(/../g)!,
            (x) => parseInt(x, 16),
          ),
          controlConfirmed: false,
        };
        await execute(
          "fixture revokes observation record before explicit rebind",
          sdk.host.revokeAgent({
            organizationId,
            humanId,
            grantId,
            managedAgentId: imported.id,
          }),
        );
        const reviewed = await managedInstance(
          new ChainReadSession(profile),
          organizationId,
          selected.hostAddress,
          selected.instanceId,
        );
        assert.ok(reviewed?.revoked);
        const rebinder = new AgentImport(
          new ChainReadSession(profile),
          device,
          grantId,
          organizationId,
          journal,
          { kind: "rebind", reviewed },
        );
        const rebindAttempt = randomUUID(),
          rebindQuote = await rebinder.prepare(selected, rebindAttempt, true);
        assert.ok(!("status" in rebindQuote));
        const rebindOptions = (rebinder.manager as any).options,
          original = rebindOptions.client;
        let rebindBroadcasts = 0,
          loseRebindQuery = false;
        const rebindCore = new Proxy(original.core, {
          get(target, property) {
            if (property === "executeTransaction")
              return async (input: any) => {
                rebindBroadcasts++;
                await target.executeTransaction(input);
                loseRebindQuery = true;
                throw new Error("injected lost rebind response");
              };
            if (property === "getTransaction")
              return async (input: any) => {
                if (loseRebindQuery) {
                  loseRebindQuery = false;
                  throw new Error("injected unavailable first rebind receipt");
                }
                return target.getTransaction(input);
              };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        rebindOptions.client = new Proxy(original, {
          get(target, property) {
            if (property === "core") return rebindCore;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const lostRebind = await rebinder.submit(rebindQuote);
        assert.equal(lostRebind.status, "unknown");
        rebinder.dispose();
        const restoredRebind = new AgentImport(
          new ChainReadSession(profile),
          device,
          grantId,
          organizationId,
          journal,
          { kind: "rebind" },
        );
        let resolvedRebind: SelfPayTransactionOutcome | undefined;
        for (let n = 0; n < 40; n++) {
          resolvedRebind = await restoredRebind.query(rebindAttempt);
          if (resolvedRebind?.status === "confirmed") break;
          await new Promise((resolve) => setTimeout(resolve, 125));
        }
        assert.equal(
          resolvedRebind?.digest,
          (lostRebind as SelfPayTransactionOutcome).digest,
        );
        await record(
          "App explicit observation rebind; lost response recovered by original digest",
          resolvedRebind!,
        );
        const rebound = await restoredRebind.confirmed(resolvedRebind!);
        assert.equal(rebound.id, imported.id);
        assert.equal(BigInt(rebound.version), BigInt(reviewed.version) + 1n);
        assert.equal(rebound.revoked, false);
        assert.equal(rebound.control_confirmed, false);
        assert.equal(rebindBroadcasts, 1);
        checks.push(
          "Explicit App rebind revives the same observation record with a new logical version; original digest recovers a lost response with one broadcast and without persisting the reviewed record",
        );

        await execute(
          "fixture revokes record for concurrent rebind test",
          sdk.host.revokeAgent({
            organizationId,
            humanId,
            grantId,
            managedAgentId: imported.id,
          }),
        );
        const beforeRace = (await managedInstance(
          new ChainReadSession(profile),
          organizationId,
          selected.hostAddress,
          selected.instanceId,
        ))!;
        const racing = new AgentImport(
          new ChainReadSession(profile),
          device,
          grantId,
          organizationId,
          journal,
          { kind: "rebind", reviewed: beforeRace },
        );
        const racingQuote = await racing.prepare(selected, randomUUID(), true);
        assert.ok(!("status" in racingQuote));
        // Deliberately bypass App preflight in this fixture to prove the on-chain
        // CAS. Save the exact digest before one raw submission; failures only query it.
        const stale = sdk.host.rebindAgent({
          ...rebindParameters,
          expectedVersion: beforeRace.version,
        });
        stale.setSender(deviceKey.toSuiAddress());
        const gasFixture = Ed25519Keypair.generate();
        await requestSuiFromFaucetV2({
          host: faucet,
          recipient: gasFixture.toSuiAddress(),
        });
        stale.setGasOwner(gasFixture.toSuiAddress());
        stale.setGasBudget(200000000);
        const staleBytes = await stale.build({ client: coreClient }),
          staleDigest = await Transaction.from(staleBytes).getDigest();
        await execute(
          "concurrent fixture rebind advances the reviewed record version",
          sdk.host.rebindAgent({
            ...rebindParameters,
            expectedVersion: beforeRace.version,
          }),
        );
        await assert.rejects(racing.submit(racingQuote), /state_changed/);
        racing.dispose();
        checks.push(
          "A second confirmed rebind changes the record while an App quote is open; stale App submission is rejected before broadcast",
        );

        const signed = await deviceKey.signTransaction(staleBytes),
          gasSigned = await gasFixture.signTransaction(staleBytes);
        transactions.push({
          label:
            "Deliberate stale reviewed version; original digest saved before raw test submission",
          digest: staleDigest,
          phase: "prepared",
        });
        await save();
        let staleReceipt: any;
        try {
          staleReceipt = await coreClient.core.executeTransaction({
            transaction: staleBytes,
            signatures: [signed.signature, gasSigned.signature],
            include: { effects: true },
          });
        } catch (error) {
          const failure = error as Error & { code?: string };
          transactions.push({
            label:
              "Raw stale-version execution RPC returned an error; query original digest",
            digest: staleDigest,
            rpcError: {
              name: failure.name,
              message: failure.message,
              code: failure.code,
            },
          });
          await save();
          for (let n = 0; n < 40; n++) {
            try {
              staleReceipt = await coreClient.core.getTransaction({
                digest: staleDigest,
                include: { effects: true },
              });
              break;
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 125));
            }
          }
        }
        assert.ok(
          staleReceipt,
          "Query original stale-version transaction; do not resend",
        );
        const failed =
          staleReceipt.$kind === "Transaction"
            ? staleReceipt.Transaction
            : staleReceipt.FailedTransaction;
        assert.equal(failed.digest, staleDigest);
        assert.equal(failed.status.success, false);
        assert.match(JSON.stringify(failed.status.error), /9208/);
        transactions.push({
          label: "Contract CAS rejects stale reviewed version atomically",
          digest: staleDigest,
          status: "failed",
          error: failed.status.error,
          gasUsed: failed.effects.gasUsed,
        });
        await save();
        const afterRace = (await managedInstance(
          new ChainReadSession(profile),
          organizationId,
          selected.hostAddress,
          selected.instanceId,
        ))!;
        assert.equal(afterRace.id, imported.id);
        assert.equal(
          BigInt(afterRace.version),
          BigInt(beforeRace.version) + 1n,
        );
        assert.equal(afterRace.revoked, false);
        assert.equal(afterRace.control_confirmed, false);
        checks.push(
          "Actual on-chain stale-version execution fails with host E_VERSION 9208 and leaves the winning record unchanged; no new instance or execution permission is created",
        );
        deviceHttp = {
          ...(deviceHttp as object),
          agentRebindVerified: true,
          rebindRecordId: rebound.id,
          rebindBroadcasts,
          originalRebindDigestRecovered: true,
          staleRebindQuoteRejected: true,
          contractRebindCasRejected: true,
          reboundVersion: rebound.version,
          finalRecordVersion: afterRace.version,
        };
      }
      deviceHttp = {
        ...(deviceHttp as object),
        agentImportVerified: true,
        importRecordId: imported.id,
        importBroadcasts,
        duplicateImportAvoided: true,
        originalImportDigestRecovered: true,
        contractDuplicateReceiptVerified: true,
      };
      checks.push(
        "Production App imports the actual discovered instance for observation only on Sui; injected lost response recovers original digest with one broadcast; a fresh controller reconstructs the indexed record and avoids duplicate quotation/payment",
      );
    }
  }
  deviceHttp = {
    ...(deviceHttp as object),
    unsignedRejected: true,
    bearerRejected: true,
    actualAppDeviceProofAndSignedResponse: true,
    coordinatorObservedHost: observed.host_id,
    observedAt: observed.last_heartbeat,
    hostSignatureVerified: true,
    tamperedHostBodyRejected: true,
    hostMembershipId: independent[0].membershipId,
    appDisplaySchemaVerified: true,
    realTmuxDiscoveryVerified:
      process.env.FM_ENVD_AGENT_DISCOVERY === "1" &&
      process.env.FM_ENVD_NATIVE_DISCOVERY !== "1",
    nativeFileDiscoveryVerified: process.env.FM_ENVD_NATIVE_DISCOVERY === "1",
  };
  checks.push(
    "App production read client uses injected fixture device signing; Go verifies current grant; unsigned/token reads denied and Coordinator-signed response returns actual Host heartbeat",
  );
  checks.push(
    "Go Host signs its actual heartbeat; App independently verifies exact body, current membership pointer, scoped chain and Coordinator versions; forged body remains unknown",
  );
}
if (process.env.FM_ENVD_HOST_REJOIN === "1") {
  assert.ok(
    liveReads &&
      signedHostSnapshot &&
      earlyPublic &&
      (deviceHttp as any)?.agentImportVerified,
  );
  beforeHostRevocation = await liveReads.prepare(bindingId);
}
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
if (signedHostSnapshot) {
  const revokedObservation = await verifyHostObservations(
    new ChainReadSession(profile),
    organizationId,
    bindingId,
    signedHostSnapshot,
  );
  assert.equal(revokedObservation[0].state, "unknown");
  assert.equal(revokedObservation[0].observation, null);
  deviceHttp = {
    ...(deviceHttp as object),
    retainedHostSignatureRejectedAfterRevocation: true,
  };
  checks.push(
    "a retained, cryptographically valid Host heartbeat cannot regain trust after actual chain membership revocation",
  );
}
checks.push(
  "membership revocation remains chain-owned and visible; consumed-invite revocation never substitutes for it",
);
if (earlyHarness) {
  earlyHarness.helper.stdin.write("REVOKED\n");
  envdConnection = await earlyHarness.connectionReady;
  checks.push(
    "real loopback Coordinator/Host mutually authenticate using chain endpoint and keys; live heartbeat observed; App chain revocation rejects both Coordinator routing and worker heartbeat",
  );
}
if (process.env.FM_ENVD_HOST_REJOIN === "1") {
  assert.ok(earlyHarness && earlyPublic && liveReads && signedHostSnapshot);
  const renewedInvite = await invite(
    "App explicitly creates invitation to rejoin the same Host",
  );
  earlyHarness.helper.stdin.write("REJOIN\n");
  await earlyHarness.rejoinReady;
  // Bearer code is sent only after the public readiness marker, never argv or logs.
  earlyHarness.helper.stdin.write(
    `${renewedInvite.code}\nJOIN ${organizationId}\n`,
  );
  const rejoined = await earlyHarness.rejoinResult;
  assert.equal(rejoined.broadcasts, 2);
  assert.equal(rejoined.same_host_keys, true);
  assert.equal(rejoined.same_worker_reauthenticated, true);
  assert.equal(rejoined.result.state, "confirmed");
  const newMembershipId = rejoined.result.membership.membership_id;
  assert.notEqual(newMembershipId, membershipId);
  assert.equal(
    rejoined.result.membership.host_address,
    earlyPublic.host_address,
  );
  const originalLookup = await coreClient.core.getTransaction({
    digest: rejoined.result.digest,
    include: {
      effects: true,
      objectTypes: true,
      events: true,
      balanceChanges: true,
      transaction: true,
    },
  });
  assert.equal(originalLookup.$kind, "Transaction");
  await record(
    "Same Go Host explicitly rejoins; lost response recovered once from disk journal",
    {
      status: "confirmed",
      digest: rejoined.result.digest,
      requestId: "go-envd-rejoin-fixture",
      actualGas: rejoined.result.actual_fee_mist,
      journalSynced: true,
      transaction: originalLookup.Transaction!,
    },
  );
  // Prove the archived technical digest was not discarded when NewAttempt moved
  // the known original to history. These records contain no invitation material.
  const { createHash } = await import("node:crypto");
  const namespace = createHash("sha256")
    .update(`${deployment.chain.chainIdentifier}:${earlyPublic.host_address}`)
    .digest("hex");
  const archived = JSON.parse(
    await readFile(
      `${process.argv[3]}.journal/${namespace}/${rejoined.archived_original_digest}.json`,
      "utf8",
    ),
  );
  const pending = JSON.parse(
    await readFile(
      `${process.argv[3]}.journal/${namespace}/pending.json`,
      "utf8",
    ),
  );
  assert.equal(archived.digest, joined.digest);
  assert.equal(pending.digest, rejoined.result.digest);
  await assert.rejects(beforeHostRevocation!.send(), /device_read_rejected/);
  const oldSigned = (signedHostSnapshot as any).sentinels[0].host_observation;
  assert.ok(
    oldSigned.expires_at_ms > Date.now(),
    "Old signature must still be time-valid to prove membership replacement rejection",
  );
  const rejectedOld = await verifyHostObservations(
    new ChainReadSession(profile),
    organizationId,
    bindingId,
    signedHostSnapshot,
  );
  assert.equal(rejectedOld[0].state, "unknown");
  assert.equal(rejectedOld[0].observation, null);
  let rows: Awaited<ReturnType<CoordinatorReadClient["readHosts"]>> = [];
  for (let n = 0; n < 30; n++) {
    rows = await liveReads.readHosts(bindingId);
    if (
      rows[0]?.state === "verified" &&
      rows[0].membershipId === newMembershipId
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(rows[0]?.state, "verified");
  assert.equal(rows[0].membershipId, newMembershipId);
  const newScan = rows[0].discovery;
  assert.equal(newScan?.state, "complete");
  assert.equal(newScan?.instances.length, 1);
  const observedAgain = newScan!.instances[0];
  const recordId = (deviceHttp as any).importRecordId;
  const priorRecord = await sdk.host.getManagedAgent(recordId);
  assert.equal(observedAgain.instanceId, priorRecord.instance_id);
  assert.equal(
    observedAgain.workspaceHash,
    priorRecord.workspace_hash
      .map((x) => x.toString(16).padStart(2, "0"))
      .join(""),
  );
  const selected = {
    bindingId,
    hostAddress: earlyPublic.host_address,
    instanceId: observedAgain.instanceId,
    workspaceHash: observedAgain.workspaceHash,
  };
  const oldManaged = await managedInstance(
    new ChainReadSession(profile),
    organizationId,
    selected.hostAddress,
    selected.instanceId,
  );
  assert.ok(oldManaged);
  assert.equal(oldManaged.id, recordId);
  assert.equal(oldManaged.membership_id, membershipId);
  const ordinaryImport = new AgentImport(
    new ChainReadSession(profile),
    device,
    grantId,
    organizationId,
    journal,
  );
  await assert.rejects(
    ordinaryImport.prepare(selected, randomUUID(), true),
    /existing_conflict/,
  );
  ordinaryImport.dispose();
  const explicitRebind = new AgentImport(
    new ChainReadSession(profile),
    device,
    grantId,
    organizationId,
    journal,
    { kind: "rebind", reviewed: oldManaged },
  );
  const rebindQuote = await explicitRebind.prepare(
    selected,
    randomUUID(),
    true,
  );
  assert.ok(!("status" in rebindQuote));
  const rebindOutcome = await explicitRebind.submit(rebindQuote);
  assert.ok(rebindOutcome.status !== "already-imported");
  await record(
    "App explicitly rebinds continuous instance to new Host membership",
    rebindOutcome,
  );
  const newRecord = await explicitRebind.confirmed(rebindOutcome, selected);
  assert.equal(newRecord.id, recordId);
  assert.equal(newRecord.instance_id, oldManaged.instance_id);
  assert.equal(newRecord.membership_id, newMembershipId);
  assert.equal(BigInt(newRecord.version), BigInt(oldManaged.version) + 1n);
  assert.equal(newRecord.control_confirmed, false);
  assert.equal(newRecord.runtime, "tmux-observe");
  envdRejoin = {
    ...rejoined,
    archivedDigestVerified: true,
    newOriginalDigestVerified: true,
    timeValidOldSignatureRejected: true,
    previousDeviceChallengeRejected: true,
    sameKernelInstanceVerified: true,
    newMembershipId,
    recordId,
    instanceId: newRecord.instance_id,
    recordVersion: newRecord.version,
    automaticImportRejected: true,
    explicitRebindVerified: true,
  };
  checks.push(
    "Same live Go worker and unchanged Host keys explicitly rejoin through new chain invitation; original disk digest archived, new response loss recovered once, worker reauthenticates and sends a fresh native tmux scan",
  );
  checks.push(
    "Time-valid old Host signature and pre-revocation device challenge remain rejected after membership replacement; fresh signature proves the new active member and same kernel instance",
  );
  checks.push(
    "App ordinary import cannot silently replace an old membership; explicit reviewed-version rebind retains record/instance IDs, adopts new member and stays observation-only",
  );
}
const invitesBeforeReload = (await controller.directory()).invitations.length;
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
assert.equal(
  (await controller.directory()).invitations.length,
  invitesBeforeReload + 1,
);
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
const beforeDeviceRevoked = liveReads
  ? await liveReads.prepare(bindingId)
  : undefined;
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
if (beforeDeviceRevoked && earlyHarness) {
  await assert.rejects(
    beforeDeviceRevoked.send(),
    (error) =>
      error instanceof DeviceIdentityError && error.code === "invalid_grant",
  );
  earlyHarness.helper.stdin.end("DONE\n");
  await earlyHarness.done;
  deviceHttp = {
    ...(deviceHttp as object),
    deviceRevokedAfterChallengeRejected: true,
  };
  checks.push(
    "device revocation after challenge preparation is rejected by the App's fresh chain authority check before HTTP dispatch; no cached device login survives",
  );
}
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
  envdCli,
  envdConnection,
  envdRejoin,
  nativeExecution,
  deviceHttp,
  limits: {
    generatedFixtureKeysOnly: true,
    injectedNativeTransport: true,
    memoryTechnicalJournal: true,
    appTechnicalJournal: "injected memory journal",
    envdTechnicalJournal: envdCli ? "real disk journal" : "not exercised",
    envdRecovery: envdCli
      ? "new runner in the same test process"
      : "not exercised",
    installedAppVerified: false,
    nativeStoreVerified: false,
    envdJoinCliVerified: false,
    envdJoinCliInjectedKeysVerified: !!envdCli,
    envdJoinQuoteVerified: !!envdQuote,
    loopbackChainConnectionVerified: !!envdConnection,
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

fixtureContentKey.fill(0);
