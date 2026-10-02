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
type CliHello = {
  host_address: string;
  signing_public_key: string;
  encryption_public_key: string;
  coordinator_public_key?: string;
  coordinator_address?: string;
  coordinator_endpoint?: string;
};
const liveConnection = process.env.FM_ENVD_CHAIN_CONNECTION === "1";
assert.ok(!liveConnection || process.env.FM_ENVD_JOIN_CLI_BIN);
let envdConnection: unknown;
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
    connectionResolve!: (value: unknown) => void;
  let publicReject!: (error: Error) => void,
    resultReject!: (error: Error) => void,
    connectionReject!: (error: Error) => void;
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
  helper.stdout.on("data", (part) => {
    output += String(part);
    buffer += String(part);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        if (line.startsWith("FM_ENVD_HOST_PUBLIC "))
          publicResolve(JSON.parse(line.slice("FM_ENVD_HOST_PUBLIC ".length)));
        if (line.startsWith("FM_HOST_JOIN_CLI_RESULT "))
          resultResolve(
            JSON.parse(line.slice("FM_HOST_JOIN_CLI_RESULT ".length)),
          );
        if (line.startsWith("FM_CHAIN_CONNECTION_RESULT "))
          connectionResolve(
            JSON.parse(line.slice("FM_CHAIN_CONNECTION_RESULT ".length)),
          );
      } catch (error) {
        publicReject(error as Error);
        resultReject(error as Error);
        connectionReject(error as Error);
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
  return { helper, publicReady, resultReady, connectionReady, done };
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
    const scan = honest[0].discovery;
    assert.equal(scan?.state, "complete");
    assert.equal(scan?.instances.length, 1);
    assert.equal(scan?.instances[0].session, "agent-chain-existing");
    assert.equal(scan?.instances[0].state, "observed");
    assert.equal(scan?.instances[0].runtime, "tmux-observe");
    assert.equal(scan?.instances[0].continuity, "kernel-process-v1");
    assert.match(scan!.instances[0].instanceId, /^tmux-[0-9a-f]{64}$/);
    assert.ok(scan!.freshUntilMs! > Date.now());
    checks.push(
      "Actual isolated tmux pane and native kernel birth identity traverse Host signature, authenticated Coordinator read and App discovery verification; observation-only capabilities and independent scan deadline preserved",
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
      assert.equal(imported.runtime, "tmux-observe");
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
          runtime: "tmux-observe",
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
      if (process.env.FM_ENVD_AGENT_REBIND === "1") {
        const rebindParameters = {
          organizationId,
          humanId,
          grantId,
          membershipId,
          bindingId,
          managedAgentId: imported.id,
          runtime: "tmux-observe" as const,
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
        "Production App imports the actual discovered pane for observation only on Sui; injected lost response recovers original digest with one broadcast; a fresh controller reconstructs the indexed record and avoids duplicate quotation/payment",
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
    realTmuxDiscoveryVerified: process.env.FM_ENVD_AGENT_DISCOVERY === "1",
  };
  checks.push(
    "App production read client uses injected fixture device signing; Go verifies current grant; unsigned/token reads denied and Coordinator-signed response returns actual Host heartbeat",
  );
  checks.push(
    "Go Host signs its actual heartbeat; App independently verifies exact body, current membership pointer, scoped chain and Coordinator versions; forged body remains unknown",
  );
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
  await assert.rejects(beforeDeviceRevoked.send(), /device_read_rejected/);
  earlyHarness.helper.stdin.end("DONE\n");
  await earlyHarness.done;
  deviceHttp = {
    ...(deviceHttp as object),
    deviceRevokedAfterChallengeRejected: true,
  };
  checks.push(
    "device revocation after challenge preparation is rejected by actual Coordinator HTTP authority check; no cached device login survives",
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
