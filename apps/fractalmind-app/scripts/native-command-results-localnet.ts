/** Real OS vault + Sui command-result preparation. Host keys/instance are an
 * isolated fixture: no physical discovery, envd delivery or handover claim.
 * Reports contain no recovery code, private key or decrypted keyring. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  MemoryTransactionJournal,
  SelfPayTransactionManager,
  createDeviceEncryptionKeys,
  createHostInviteMaterial,
  encodeHostInviteCode,
  signNodeCommand,
  nodeCommandIntentHash,
  bytesToHex,
  unwrapKeys,
  commandResultWrapContext,
  encryptCommandResult,
  recordContext,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { NativeRecoverySigner } from "../src/native-onboarding";
import { IdentityCreation, normalizeDeployment } from "../src/onboarding";
import { ChainReadSession } from "../src/chain";
import { NativeCommandResults } from "../src/command-results";
import { OkrDraftCreation } from "../src/okr-draft";
assert.ok(
  process.argv[2] && process.argv[3],
  "Pass isolated deployment and a new output report",
);
const output = process.argv[3],
  progress = output + ".progress.json";
for (const path of [output, progress]) {
  try {
    await access(path);
    throw new Error(
      "Inspect the existing original requests; do not overwrite or restart",
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
const deployment = JSON.parse(await readFile(process.argv[2], "utf8")),
  profile = `test-${randomUUID()}`;
const helper = resolve("native/target/debug/examples/device-test-helper"),
  rpc = "http://127.0.0.1:29000",
  faucet = "http://127.0.0.1:29123";
const checks: string[] = [],
  transactions: unknown[] = [];
let coreForVisibility: ChainReadSession["sdk"]["client"]["client"] | undefined;
let created = false,
  cleanupConfirmed = false,
  state: Record<string, unknown> = { phase: "before_native_creation" };
function request(action: string, extra: Record<string, string> = {}) {
  const result = spawnSync(helper, [], {
    input: JSON.stringify({ action, profile, ...extra }),
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1500000,
  });
  if (result.status !== 0)
    throw new Error(
      result.stderr.trim() ||
        "Native helper failed or timed out; inspect the original profile",
    );
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
        bytes: args.bytes,
        network: args.network,
      });
    case "fm_device_public":
      return request("public");
    case "fm_device_prove":
      return request("proveDevice", { challenge: args.challenge });
    case "fm_device_sign_transaction":
      return request("signTransaction", { bytes: args.bytes });
    case "fm_device_sign_node_command":
      return request("signNodeCommand", { bytes: args.bytes });
    case "fm_device_encrypt_record":
      return request("encryptRecord", { record: args.record });
    case "fm_device_decrypt_record":
      return request("decryptRecord", { record: args.record });
    case "fm_device_wrap_command_result_key":
      return request("wrapCommandResultKey", { record: args.request });
    default:
      throw new Error("Unexpected native operation");
  }
};
async function save(complete = false) {
  await writeFile(
    complete ? output : progress,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        complete,
        chain: deployment.chain,
        packageId: deployment.packageId,
        checks,
        transactions,
        state,
        limits: {
          actualOSVault: true,
          installedUIVerified: false,
          envdDispatchVerified: false,
          physicalHostVerified: false,
          humanHandoverVerified: false,
          nativeWindowSourceVerified: false,
          testTransport: "isolated subprocess",
          technicalJournal: "memory",
          cleanupConfirmed,
          privateKeysInReport: false,
          recoveryCodeInReport: false,
        },
      },
      null,
      2,
    ) + "\n",
  );
}
async function preparedQuote(
  label: string,
  quote: { requestId: string; digest: string },
) {
  state = {
    ...state,
    originalRequest: {
      label,
      requestId: quote.requestId,
      digest: quote.digest,
      phase: "quoted_before_submission",
    },
  };
  await save();
}
async function record(label: string, outcome: SelfPayTransactionOutcome) {
  transactions.push({
    label,
    requestId: outcome.requestId,
    digest: outcome.digest,
    status: outcome.status,
    actualGas: outcome.actualGas,
    createdObjects: outcome.transaction?.effects.changedObjects
      .filter((x) => x.idOperation === "Created")
      .map((x) => ({
        id: x.objectId,
        type: outcome.transaction?.objectTypes?.[x.objectId],
        outputState: x.outputState,
      })),
  });
  await save();
  assert.equal(
    outcome.status,
    "confirmed",
    `Query original ${outcome.digest}; no retry`,
  );
  assert.ok(outcome.actualGas !== undefined);
  if (coreForVisibility)
    for (const changed of outcome.transaction!.effects.changedObjects.filter(
      (x) => x.idOperation === "Created" && x.outputState === "ObjectWrite",
    ))
      await readVisible(
        () => coreForVisibility!.core.getObject({ objectId: changed.objectId }),
        (v) => v.object.objectId === changed.objectId,
      );
}
async function readVisible<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
) {
  const until = Date.now() + 15000;
  let last: unknown;
  do {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < until);
  throw new Error(
    `Original effects not visible; no replay: ${last instanceof Error ? last.message : "read timeout"}`,
  );
}
try {
  const createdIdentity = await NativeRecoverySigner.create(
    invoke,
    profile,
    "localnet",
  );
  created = true;
  const recovery = createdIdentity.signer,
    device = await NativeDeviceSigner.load(invoke, profile);
  createdIdentity.recoveryCode = "";
  const connection = normalizeDeployment({
    network: "localnet",
    rpcUrl: rpc,
    packageId: deployment.packageId,
    registryId: deployment.registryId,
    chainIdentifier: deployment.chain.chainIdentifier,
  });
  const creation = new IdentityCreation(
    connection,
    recovery,
    device,
    new MemoryTransactionJournal(),
  );
  coreForVisibility = creation.sdk.client.client;
  assert.equal(
    (await creation.sdk.client.client.core.getChainIdentifier())
      .chainIdentifier,
    deployment.chain.chainIdentifier,
  );
  for (const recipient of [
    recovery.material.recovery.address,
    device.device.address,
  ])
    await requestSuiFromFaucetV2({ host: faucet, recipient });
  const identityQuote = await creation.prepareIdentity();
  assert.ok(!("status" in identityQuote));
  await preparedQuote("native self-paid Human creation", identityQuote);
  await record(
    "native self-paid Human creation",
    await creation.submitIdentity(identityQuote),
  );
  await readVisible(
    () => creation.locate(),
    (v) => v !== null,
  );
  const orgQuote = await creation.prepareOrganization(
    `Native-command-result-${randomUUID()}`,
  );
  assert.ok(!("status" in orgQuote));
  await preparedQuote("native self-paid organization creation", orgQuote);
  await record(
    "native self-paid organization creation",
    await creation.submitOrganization(orgQuote),
  );
  const located = await readVisible(
    () => creation.locate(),
    (v) => v?.organizations.length === 1,
  );
  assert.ok(located);
  const organizationId = located.organizations[0].objectId,
    chain = new ChainReadSession(located.profile),
    sdk = chain.sdk;
  const auth = {
    organizationId,
    humanId: located.profile.humanId,
    grantId: located.grantId,
  };
  state = {
    phase: "native_identity_confirmed",
    humanId: auth.humanId,
    organizationId,
    deviceAddress: device.device.address,
  };
  await save();
  checks.push(
    "real native recovery and device signatures create Human and organization on the existing isolated chain",
  );
  const draft = new OkrDraftCreation(
    chain,
    device,
    auth.grantId,
    organizationId,
    randomUUID(),
    invoke,
    new MemoryTransactionJournal(),
  );
  const draftQuote = await draft.prepare({
    objective: "Test native command result preparation",
    successCriteria: "The native device alone can unlock exact command results",
    priority: 0,
    deadlineMs: String(Date.now() + 3600000),
    allowedPaths: ["docs"],
    prohibitedActions: ["external network"],
    maxCalls: "3",
    krs: [
      {
        title: "Prepare one observed command",
        unit: "command",
        precision: 0,
        baseline: "0",
        target: "1",
        weight: "1",
        maxAgeMinutes: "5",
        verificationRule: "Review exact chain provenance",
      },
    ],
  });
  assert.ok(!("status" in draftQuote));
  await preparedQuote("native encrypted draft", draftQuote);
  await record(
    "native encrypted draft establishes current record key directory",
    await draft.submit(draftQuote),
  );
  await readVisible(
    () => sdk.productRecord.listCurrent(organizationId, null, 1),
    (v) => v.keyVersion === "1",
  );
  const host = Ed25519Keypair.generate(),
    coordinator = Ed25519Keypair.generate(),
    encryption = createDeviceEncryptionKeys();
  await requestSuiFromFaucetV2({
    host: faucet,
    recipient: host.toSuiAddress(),
  });
  const deviceManager = creation.deviceManager,
    hostManager = new SelfPayTransactionManager({
      client: sdk.client.client,
      network: "localnet",
      signer: host,
      journal: new MemoryTransactionJournal(),
    });
  function createdObject(result: SelfPayTransactionOutcome, suffix: string) {
    assert.equal(result.status, "confirmed");
    const rows = result.transaction!.effects.changedObjects.filter(
      (x) =>
        x.idOperation === "Created" &&
        result.transaction!.objectTypes?.[x.objectId] ===
          `${deployment.packageId}::${suffix}`,
    );
    assert.equal(rows.length, 1, suffix);
    return rows[0].objectId;
  }
  async function execute(
    label: string,
    transaction: Parameters<typeof deviceManager.prepare>[0]["transaction"],
    manager = deviceManager,
  ) {
    const quote = await manager.prepare({
      requestId: "native-result:" + randomUUID(),
      gasBudget: 200000000n,
      transaction,
    });
    await preparedQuote(label, quote);
    const outcome = await manager.submit(quote);
    await record(label, outcome);
    for (const changed of outcome.transaction!.effects.changedObjects.filter(
      (x) => x.idOperation === "Created" && x.outputState === "ObjectWrite",
    ))
      await readVisible(
        () => sdk.client.client.core.getObject({ objectId: changed.objectId }),
        (v) => v.object.objectId === changed.objectId,
      );
    return outcome;
  }
  const bindingId = createdObject(
    await execute(
      "create isolated Coordinator binding",
      sdk.host.createCoordinatorBinding({
        ...auth,
        publicKey: coordinator.getPublicKey().toRawBytes(),
        endpoint: "http://127.0.0.1:19000",
      }),
    ),
    "host::CoordinatorBinding",
  );
  const invite = createHostInviteMaterial("localnet"),
    inviteId = createdObject(
      await execute(
        "create one-time Host invitation",
        sdk.host.createInvite({
          ...auth,
          bindingId,
          proofPublicKey: invite.publicKey,
          expiresAtMs: Date.now() + 120000,
          membershipTtlMs: 3600000,
          capabilityTtlMs: 600000,
        }),
      ),
      "host::HostInvite",
    );
  await readVisible(
    () => sdk.host.getInvite(inviteId),
    (v) => v.id === inviteId,
  );
  const join = await sdk.host.prepareJoin({
    code: encodeHostInviteCode("localnet", inviteId, invite.entropy),
    network: "localnet",
    hostPublicKey: host.getPublicKey().toRawBytes(),
    encryptionPublicKey: encryption.publicKey,
    name: "Fixture-only Host",
  });
  invite.entropy.fill(0);
  const membershipId = createdObject(
    await execute(
      "Host fixture consumes original invitation",
      join.transaction,
      hostManager,
    ),
    "host::HostMembership",
  );
  await readVisible(
    () => sdk.host.getMembership(membershipId),
    (v) => v.id === membershipId,
  );
  const instanceId =
    "native-" +
    randomUUID().replaceAll("-", "") +
    randomUUID().replaceAll("-", "");
  const managedAgentId = createdObject(
    await execute(
      "register fixture instance as observation only",
      sdk.host.importAgent({
        ...auth,
        membershipId,
        bindingId,
        instanceId,
        runtime: "bounded-process-v1",
        workspaceHash: new Uint8Array(32).fill(1),
        controlConfirmed: false,
      }),
    ),
    "host::ManagedAgent",
  );
  await readVisible(
    () => sdk.host.getManagedAgent(managedAgentId),
    (v) => v.id === managedAgentId,
  );
  const capabilityId = createdObject(
    await execute(
      "issue exact observation capability",
      sdk.host.issueCapability({
        ...auth,
        membershipId,
        bindingId,
        managedAgentId,
        actions: ["status"],
        scope: "observation",
        maxUses: 1,
        expiresAtMs: Date.now() + 180000,
      }),
    ),
    "remote_authority::RemoteCapability",
  );
  const command = await signNodeCommand(device, {
    target: {
      organizationId,
      nodeId: host.toSuiAddress(),
      agentId: instanceId,
    },
    action: "status",
    scope: "observation",
    capability: { id: capabilityId, revocationVersion: 1n },
    payload: {},
    expiresAtMs: Date.now() + 120000,
  });
  const results = new NativeCommandResults(
      chain,
      device,
      auth.grantId,
      organizationId,
      invoke,
    ),
    input = { command, membershipId, bindingId, managedAgentId };
  const prepared = await results.prepare(input);
  checks.push(
    "production App controller checks native possession and current chain source before/after OS-only result wrapping",
  );
  const preparedManager = new SelfPayTransactionManager({
    client: sdk.client.client,
    network: "localnet",
    journal: new MemoryTransactionJournal(),
    signer: {
      getPublicKey: () => device.getPublicKey(),
      signTransaction: async (bytes) => {
        await prepared.assertCurrent();
        const signature = await device.signTransaction(bytes);
        await prepared.assertCurrent();
        return signature;
      },
    },
  });
  const requestId = "native-result-run:" + randomUUID();
  const quote = await preparedManager.prepare({
    requestId,
    gasBudget: 200000000n,
    transaction: prepared.transaction,
  });
  await prepared.assertCurrent();
  await preparedQuote("atomic result-key and Run", quote);
  const outcome = await preparedManager.submit(quote);
  await record(
    "atomic native-wrapped result grant and original Run preparation",
    outcome,
  );
  const restored = await preparedManager.query(requestId);
  assert.equal(restored!.digest, outcome.digest);
  assert.equal(restored!.status, "confirmed");
  checks.push(
    "original preparation digest is queried without another transaction or Host dispatch",
  );
  const executionId = createdObject(
      outcome,
      "node_execution::CommandExecution",
    ),
    fingerprint = bytesToHex(nodeCommandIntentHash(command));
  state = {
    ...state,
    phase: "original_run_prepared",
    managedAgentId,
    capabilityId,
    executionId,
    originalDigest: outcome.digest,
  };
  await save();
  const run = await readVisible(
    () => sdk.nodeExecution.getExecution(executionId),
    (v) => v.id === executionId,
  );
  assert.equal(run.state, 0);
  const keyGrant = await readVisible(
    () =>
      sdk.nodeExecution.getResultKey(
        capabilityId,
        nodeCommandIntentHash(command),
        "1",
      ),
    (v) => v.org_id === organizationId,
  );
  assert.equal(keyGrant.membership_id, membershipId);
  assert.equal(keyGrant.host_address, host.toSuiAddress());
  assert.equal(keyGrant.wrapped_key.length, 132);
  const derived = await unwrapKeys(
    Uint8Array.from(keyGrant.wrapped_key),
    encryption.secret,
    commandResultWrapContext(
      organizationId,
      capabilityId,
      membershipId,
      fingerprint,
      "1",
    ),
  );
  assert.equal(derived.length, 32);
  checks.push(
    "native FMW1 derivative is granted on Sui to only the exact Host, command and current key version",
  );
  await assert.rejects(
    unwrapKeys(
      Uint8Array.from(keyGrant.wrapped_key),
      encryption.secret,
      commandResultWrapContext(
        organizationId,
        capabilityId,
        membershipId,
        "ff".repeat(32),
        "1",
      ),
    ),
  );
  await assert.rejects(
    unwrapKeys(
      Uint8Array.from(keyGrant.wrapped_key),
      createDeviceEncryptionKeys().secret,
      commandResultWrapContext(
        organizationId,
        capabilityId,
        membershipId,
        fingerprint,
        "1",
      ),
    ),
  );
  checks.push(
    "wrong command wrap context and another Host cannot unwrap the native derivative",
  );
  const logicalId = "command-" + fingerprint,
    plaintext = new TextEncoder().encode(
      "Native result interoperability fixture; no Host execution claim",
    );
  const body = await encryptCommandResult(
    plaintext,
    derived,
    recordContext(organizationId, "checkpoint", logicalId, "1", "1"),
  );
  derived.fill(0);
  encryption.secret.fill(0);
  const currentGrant = await sdk.identity.getDeviceGrant(auth.grantId);
  const resultHeader = {
    network: "localnet",
    encryptedKeys: toBase64(Uint8Array.from(currentGrant.encrypted_keys)),
    organizationId,
    kind: 5,
    logicalId,
    revision: "1",
    keyVersion: "1",
    encryptedBody: toBase64(body),
  };
  assert.deepEqual(
    fromBase64(
      request("decryptRecord", { record: JSON.stringify(resultHeader) }),
    ),
    plaintext,
  );
  for (const changed of [
    { ...resultHeader, logicalId: "command-" + "ff".repeat(32) },
    { ...resultHeader, keyVersion: "2" },
    { ...resultHeader, revision: "2" },
  ])
    assert.throws(
      () => request("decryptRecord", { record: JSON.stringify(changed) }),
      /InvalidEnvelope/,
    );
  plaintext.fill(0);
  checks.push(
    "independent Host FME2 envelope decrypts natively under the on-chain device ring; wrong fingerprint/version/revision rejected",
  );
  await execute(
    "explicitly cancel original queued observation without dispatch",
    sdk.nodeExecution.requestStop({ ...auth, executionId, capabilityId }),
  );
  const cancelled = await readVisible(
    () => sdk.nodeExecution.getExecution(executionId),
    (v) => v.state === 5,
  );
  assert.equal(cancelled.result_record, null);
  checks.push(
    "fixture performs no Host delivery, creates no result claim, and explicitly cancels the original queued Run",
  );
  await execute(
    "revoke fixture Host membership",
    sdk.host.revokeMembership({ ...auth, membershipId }),
  );
  await readVisible(
    () => sdk.host.getMembership(membershipId),
    (v) => v.revoked,
  );
  await assert.rejects(prepared.assertCurrent());
  checks.push(
    "the retained production preflight rejects actual chain Host revocation",
  );
  state = {
    ...state,
    phase: "validated_and_cancelled",
    runState: cancelled.state,
    resultRecord: null,
  };
} catch (error) {
  state = {
    ...state,
    error: error instanceof Error ? error.message : String(error),
    diagnosticCause:
      error instanceof Error && error.cause && typeof error.cause === "object"
        ? error.cause
        : null,
  };
  await save();
  throw error;
} finally {
  if (created) {
    request("remove");
    cleanupConfirmed = true;
    assert.throws(() => request("public"), /NotInitialized/);
  }
  await save();
}
await save(true);
console.log(
  JSON.stringify({
    complete: true,
    checks: checks.length,
    confirmedTransactions: transactions.length,
    cleanupConfirmed,
    output,
  }),
);
