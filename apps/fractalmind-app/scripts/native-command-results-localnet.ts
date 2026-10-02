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
  handoverAcceptanceSigningBytes,
  handoverProposalHash,
  type HandoverProposal,
  type HandoverAcceptance,
  type NativeFileOkrPlan,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { NativeRecoverySigner } from "../src/native-onboarding";
import { IdentityCreation, normalizeDeployment } from "../src/onboarding";
import { ChainReadSession } from "../src/chain";
import { NativeCommandResults } from "../src/command-results";
import { NativeExecutionResults } from "../src/execution-results";
import { OkrDraftCreation } from "../src/okr-draft";
import { HandoverApproval } from "../src/handover-approval";
import { PrivateRecords } from "../src/private-records";
import { HandoverReview } from "../src/handover-review";
import { HandoverSetup } from "../src/handover-setup";
assert.ok(
  process.argv[2] && process.argv[3],
  "Pass isolated deployment and a new output report",
);
const output = process.argv[3],
  progress = output + ".progress.json";
const ticketMode = process.argv[4] === "--review-ticket";
const approvalMode = process.argv[4] === "--approve-handover" || ticketMode;
const readResultMode = process.argv[4] === "--read-result" || approvalMode;
assert.ok(
  !process.argv[4] || readResultMode,
  "Only --read-result, --approve-handover or --review-ticket is supported",
);
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
    objective: approvalMode
      ? "Prepare a reviewed documentation file goal"
      : "Test native command result preparation",
    successCriteria: approvalMode
      ? "Human independently reviews the original documentation evidence after explicit continuation"
      : "The native device alone can unlock exact command results",
    priority: 0,
    deadlineMs: String(Date.now() + 3600000),
    allowedPaths: ["docs"],
    prohibitedActions: ["external network"],
    maxCalls: "3",
    krs: [
      {
        title: approvalMode
          ? "Create one reviewed documentation file"
          : "Prepare one observed command",
        unit: approvalMode ? "files" : "command",
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
  const draftOutcome = await draft.submit(draftQuote);
  await record(
    "native encrypted draft establishes current record key directory",
    draftOutcome,
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
  const setupAttemptId = randomUUID();
  const setup = ticketMode
    ? new HandoverSetup(
        chain,
        device,
        auth.grantId,
        organizationId,
        managedAgentId,
        setupAttemptId,
        invoke,
        new MemoryTransactionJournal(),
      )
    : null;
  let capabilityId: string;
  if (setup) {
    const capQuote = await setup.prepare();
    assert.ok(!("status" in capQuote));
    await preparedQuote("official App single-use observation", capQuote);
    const capOutcome = await setup.submit(capQuote);
    await record("official App single-use observation", capOutcome);
    capabilityId = await setup.confirmed(capOutcome);
    state = {
      ...state,
      observationAttemptId: setupAttemptId,
      observationCapabilityId: capabilityId,
      observationDigest: capOutcome.digest,
    };
    await save();
    checks.push(
      "official App issues a current device-bound, one-use status capability with zero tool budget through native guarded fee confirmation; no Run or Host dispatch",
    );
  } else
    capabilityId = createdObject(
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
  const nativeFilePlan: NativeFileOkrPlan = {
    format: 1,
    paths: { "file.read": ["docs"], "file.write": ["docs"] },
    krs: [
      {
        files: [
          {
            path: "docs/APPROVED.md",
            content: "Requires explicit continuation",
          },
        ],
        maxCalls: "3",
      },
    ],
  };
  let proposal: HandoverProposal | undefined;
  if (approvalMode) {
    const okrId = createdObject(draftOutcome, "okr::Okr");
    const okr = await sdk.okr.getOkr(okrId),
      managed = await sdk.host.getManagedAgent(managedAgentId);
    proposal = {
      version: "1",
      managed_agent_id: managedAgentId,
      managed_version: managed.version,
      okr_id: okrId,
      okr_version: okr.version,
      spec_revision: okr.spec_revision,
      workspace_hash: bytesToHex(Uint8Array.from(managed.workspace_hash)),
      paths: nativeFilePlan.paths,
      budget_asset: "TOOL_CALLS",
      budget_limit: "3",
      max_calls: "3",
      expires_at_ms: Date.now() + 120000,
      review_expires_at_ms: Date.now() + 55000,
      nonce: bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32))),
    };
  }
  let command = await signNodeCommand(device, {
    target: {
      organizationId,
      nodeId: host.toSuiAddress(),
      agentId: instanceId,
    },
    action: "status",
    scope: "observation",
    capability: { id: capabilityId, revocationVersion: 1n },
    payload: proposal ? { handover_review: proposal } : {},
    expiresAtMs: Date.now() + 120000,
  });
  if (setup) {
    const request = await setup.createReview(
      createdObject(draftOutcome, "okr::Okr"),
      capabilityId,
      nativeFilePlan,
    );
    assert.equal(request.membershipId, membershipId);
    assert.equal(request.bindingId, bindingId);
    assert.equal(request.managedAgentId, managedAgentId);
    command = request.command;
    proposal = command.payload.handover_review as HandoverProposal;
    checks.push(
      "official App reads and decrypts the current draft and validates metrics, paths, constraints and budget before natively signing the exact original Host review; current versions are rechecked after signing",
    );
  }
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
  const reviewAttempt = ticketMode
    ? new HandoverReview(
        chain,
        device,
        auth.grantId,
        organizationId,
        setupAttemptId,
        invoke,
        new MemoryTransactionJournal(),
      )
    : null;
  const quote = reviewAttempt
    ? await reviewAttempt.prepare({ ...input, nativeFilePlan })
    : await preparedManager.prepare({
        requestId,
        gasBudget: 200000000n,
        transaction: prepared.transaction,
      });
  assert.ok(!("status" in quote));
  await prepared.assertCurrent();
  await preparedQuote("atomic result-key and Run", quote);
  const outcome = reviewAttempt
    ? await reviewAttempt.submit(quote)
    : await preparedManager.submit(quote);
  await record(
    "atomic native-wrapped result grant and original Run preparation",
    outcome,
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
  const restored = reviewAttempt
    ? await reviewAttempt.query()
    : await preparedManager.query(requestId);
  assert.equal(restored!.digest, outcome.digest);
  assert.ok(["confirmed", "unknown"].includes(restored!.status));
  state = { ...state, originalQueryStatus: restored!.status };
  await save();
  checks.push(
    `original preparation digest is queried without replay; query status ${restored!.status}, original successful fee receipt retained`,
  );
  const run = await readVisible(
    () => sdk.nodeExecution.getExecution(executionId),
    (v) => v.id === executionId,
  );
  assert.equal(run.state, 0);
  if (reviewAttempt) {
    const rebuilt = new HandoverReview(
      chain,
      device,
      auth.grantId,
      organizationId,
      reviewAttempt.attemptId,
      invoke,
      new MemoryTransactionJournal(),
    );
    const restoredTicket = await readVisible(
      () => rebuilt.restore(),
      (v) => v.run?.id === executionId,
    );
    assert.equal(restoredTicket.originalOutcome, undefined);
    assert.equal(restoredTicket.run!.id, executionId);
    assert.equal(restoredTicket.preparationDigest, outcome.digest);
    assert.deepEqual(restoredTicket.ticket!.input.command, command);
    assert.deepEqual(
      restoredTicket.ticket!.input.nativeFilePlan,
      nativeFilePlan,
    );
    assert.equal(restoredTicket.pointer!.revision, "1");
    await assert.rejects(rebuilt.send(false), /confirmation_required/);
    checks.push(
      "official App atomically persists exact native-encrypted review ticket/result-key grant/original Run; an empty technical journal reconstructs the same signed command and plan from Sui without new preparation or delivery",
    );
    state = {
      ...state,
      reviewAttemptId: reviewAttempt.attemptId,
      reviewTicketId: restoredTicket.pointer!.record_id,
      reviewRequestId: reviewAttempt.requestId,
      reviewDeliveryDispatched: false,
    };
    await save();
  }
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
  let acceptance: HandoverAcceptance | undefined;
  if (approvalMode) {
    await execute(
      "fixture Host begins original review",
      sdk.nodeExecution.beginCommand({
        ...auth,
        executionId,
        capabilityId,
        membershipId,
        bindingId,
        managedAgentId,
      }),
      hostManager,
    );
    await readVisible(
      () => sdk.nodeExecution.getExecution(executionId),
      (v) => v.state === 1,
    );
    const coverage = await sdk.nodeExecution.readAgentExecutions(
      organizationId,
      managedAgentId,
    );
    acceptance = {
      version: "1",
      execution_id: executionId,
      organization_id: organizationId,
      human_id: auth.humanId,
      grant_id: auth.grantId,
      membership_id: membershipId,
      binding_id: bindingId,
      host_address: host.toSuiAddress(),
      instance_id: instanceId,
      proposal: proposal!,
      coverage_revision: coverage.revision,
      observed_at_ms: Number((await chain.human()).clockMs),
      signature: "",
    };
    acceptance.signature = `ed25519:${bytesToHex(host.getPublicKey().toRawBytes())}:${bytesToHex(await host.sign(handoverAcceptanceSigningBytes(acceptance)))}`;
  }
  const logicalId = "command-" + fingerprint,
    plaintext = new TextEncoder().encode(
      JSON.stringify({
        version: "1",
        response: {
          schema_version: "1",
          adapter: "agent-manager-runtime",
          command_id: command.command_id,
          operation: "status",
          duplicate: false,
          ok: true,
          observed_at: new Date().toISOString(),
          result: {
            fixture: true,
            description: "No physical envd execution claim",
          },
          error: null,
          execution_id: executionId,
          execution_state: "succeeded",
          transaction_digest: "UNTRUSTED-FIXTURE-DIGEST",
          ...(acceptance ? { handover_review: acceptance } : {}),
        },
        event: {
          version: "1",
          command_id: command.command_id,
          target: command.target,
          type: "runtime_completed",
          result_code: "runtime_completed",
          occurred_at_ms: Date.now(),
        },
      }),
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
  const reader = new NativeExecutionResults(
    chain,
    device,
    auth.grantId,
    organizationId,
    invoke,
  );
  let finalRun;
  if (readResultMode) {
    if (!approvalMode)
      await execute(
        "fixture Host begins original observation",
        sdk.nodeExecution.beginCommand({
          ...auth,
          executionId,
          capabilityId,
          membershipId,
          bindingId,
          managedAgentId,
        }),
        hostManager,
      );
    const started = await readVisible(
      () => sdk.nodeExecution.getExecution(executionId),
      (v) => v.state === 1,
    );
    const finished = await execute(
      "fixture Host publishes original encrypted result",
      sdk.nodeExecution.finishCommand({
        executionId,
        capabilityId,
        organizationId,
        finalState: 2,
        expectedCursor: started.cursor,
        spentAmount: "0",
        keyVersion: "1",
        encryptedResult: body,
      }),
      hostManager,
    );
    finalRun = await readVisible(
      () => sdk.nodeExecution.getExecution(executionId),
      (v) => v.state === 2,
    );
    const result = await reader.read(executionId, managedAgentId);
    assert.equal(result.recordId, finalRun.result_record);
    assert.equal(result.transactionDigest, finished.digest);
    assert.equal(result.response!.transaction_digest, finished.digest);
    assert.deepEqual(result.response!.result, {
      fixture: true,
      description: "No physical envd execution claim",
    });
    checks.push(
      "production App reads exact immutable original Run result, decrypts via actual OS vault and replaces untrusted plaintext digest with creation transaction provenance",
    );
    state = { ...state, resultCreationDigest: finished.digest };
    await save();
    if (approvalMode) {
      await readVisible(
        () =>
          sdk.nodeExecution.readAgentExecutions(organizationId, managedAgentId),
        (v) =>
          BigInt(v.revision) === BigInt(acceptance!.coverage_revision) + 1n,
      );
      if (reviewAttempt) {
        const originalReview = await reviewAttempt.readAcceptance();
        assert.deepEqual(originalReview.acceptance, acceptance);
        checks.push(
          "official App reconstructs the original review ticket and authenticates the fixture Host acceptance from the exact immutable result without regenerating command or proposal",
        );
      }
      const approval = new HandoverApproval(
        chain,
        device,
        auth.grantId,
        organizationId,
        executionId,
        invoke,
        new MemoryTransactionJournal(),
      );
      const approvalInput = { command, nativeFilePlan };
      const approvalQuote = await approval.prepare(approvalInput);
      assert.ok(!("status" in approvalQuote));
      await preparedQuote(
        "explicit official App approval of original Host proof",
        approvalQuote,
      );
      assert.equal((await sdk.okr.getOkr(proposal!.okr_id)).state, 0);
      assert.equal(
        (await sdk.host.getManagedAgent(managedAgentId)).control_confirmed,
        false,
      );
      checks.push(
        "official App decrypts the current spec and validates exact Host review/paths/file plan/metrics/budget before an ephemeral quote; quoting does not grant control",
      );
      const approved = await approval.submit(approvalQuote);
      await record(
        "official App native signature atomically consumes original Host review and approves OKR",
        approved,
      );
      const activeOkr = await readVisible(
        () => sdk.okr.getOkr(proposal!.okr_id),
        (v) => v.state === 1,
      );
      const policy = await sdk.handover.getPolicy(activeOkr.id),
        approvedProof = await sdk.handover.getApproval(policy.approval_id);
      assert.equal(approvedProof.review_execution_id, executionId);
      assert.equal(approvedProof.review_result_id, finalRun.result_record);
      assert.equal(approvedProof.managed_version, "2");
      assert.equal(activeOkr.agreement_version, "1");
      assert.equal(policy.max_calls, "3");
      assert.equal(
        bytesToHex(Uint8Array.from(policy.proposal_hash)),
        bytesToHex(handoverProposalHash(proposal!)),
      );
      const agreementHead = await sdk.productRecord.getCurrent(
        organizationId,
        "contract",
        `okr-${activeOkr.logical_id}-agreement`,
      );
      const privateRecords = new PrivateRecords(
        chain,
        device,
        auth.grantId,
        organizationId,
        invoke,
      );
      const agreedBody = await privateRecords.read({
        ...agreementHead,
        kind: 2,
        logicalId: `okr-${activeOkr.logical_id}-agreement`,
      });
      try {
        const agreement = JSON.parse(new TextDecoder().decode(agreedBody));
        assert.deepEqual(agreement.nativeFilePlan, nativeFilePlan);
        assert.deepEqual(agreement.hostAcceptance, acceptance);
        assert.equal(agreement.specRecordId, activeOkr.spec_record);
      } finally {
        agreedBody.fill(0);
      }
      const after = await sdk.nodeExecution.readAgentExecutions(
        organizationId,
        managedAgentId,
      );
      assert.equal(after.executions.length, 1);
      assert.equal(after.unsettledControl, 0);
      const originalApproval = await approval.query();
      assert.equal(originalApproval!.digest, approved.digest);
      assert.ok(["confirmed", "unknown"].includes(originalApproval!.status));
      checks.push(
        "actual native App approval creates exact on-chain policy/immutable proof and natively decryptable agreement; no continuation Run or Host delivery is created",
      );
      checks.push(
        "original approval digest is queried before rebuilding; original successful Gas receipt and potentially pruned query remain distinct without replay",
      );
      state = {
        ...state,
        approvalDigest: approved.digest,
        approvalQueryStatus: originalApproval!.status,
        approvalId: policy.approval_id,
        okrId: activeOkr.id,
        agreementRecordId: activeOkr.agreement_record,
        agreementVersion: activeOkr.agreement_version,
        managedVersion: approvedProof.managed_version,
        explicitContinuationDispatched: false,
      };
      await save();
    }
  } else {
    await execute(
      "explicitly cancel original queued observation without dispatch",
      sdk.nodeExecution.requestStop({ ...auth, executionId, capabilityId }),
    );
    finalRun = await readVisible(
      () => sdk.nodeExecution.getExecution(executionId),
      (v) => v.state === 5,
    );
    assert.equal(finalRun.result_record, null);
    checks.push(
      "fixture performs no Host delivery, creates no result claim, and explicitly cancels the original queued Run",
    );
  }
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
  if (readResultMode) {
    assert.equal(
      (await reader.read(executionId, managedAgentId)).recordId,
      finalRun.result_record,
    );
    checks.push(
      "Host revocation blocks new preparation while currently authorized device can still read original historical result without replay",
    );
  }
  state = {
    ...state,
    phase: approvalMode
      ? "validated_native_approval_without_continuation"
      : readResultMode
        ? "validated_original_result"
        : "validated_and_cancelled",
    runState: finalRun.state,
    resultRecord: finalRun.result_record,
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
