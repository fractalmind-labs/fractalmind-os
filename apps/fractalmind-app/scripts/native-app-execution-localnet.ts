/** Actual native App controllers + localnet + production envd/Coordinator.
 * Human keys use the OS vault; Go Host keys use an isolated memory provider.
 * No installed UI, cloud machine or general model-planning claim. */
import assert from "node:assert/strict";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import {
  MemoryTransactionJournal,
  type NativeFileOkrPlan,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { NativeRecoverySigner } from "../src/native-onboarding";
import { IdentityCreation, normalizeDeployment } from "../src/onboarding";
import { ChainReadSession } from "../src/chain";
import { NativeExecutionResults } from "../src/execution-results";
import { OkrDraftCreation } from "../src/okr-draft";
import { HandoverApproval } from "../src/handover-approval";
import { HandoverReview } from "../src/handover-review";
import { HandoverSetup } from "../src/handover-setup";
import { NativeOkrRunner } from "../src/native-okr-runner";
import { OkrControl } from "../src/okr-control";
import { HostAdmission } from "../src/host-admission";
import { AgentImport } from "../src/agent-import";
import { CoordinatorReadClient } from "../src/coordinator-read";
import { canonical } from "../src/handover-plan";
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
let hostProcess: ChildProcessWithoutNullStreams | undefined;
let hostCompleted = false;
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
          envdDispatchVerified:
            state.phase === "validated_native_app_real_envd",
          hostKeyStorage: "isolated memory provider",
          realCoordinatorDeviceHTTP: true,
          humanFinalAcceptanceVerified: false,
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
  function createdObject(result: SelfPayTransactionOutcome, suffix: string) {
    const matches = result.transaction!.effects.changedObjects.filter(
      (o) =>
        o.idOperation === "Created" &&
        result.transaction!.objectTypes?.[o.objectId] ===
          `${deployment.packageId}::${suffix}`,
    );
    assert.equal(matches.length, 1, suffix);
    return matches[0].objectId;
  }
  const binary = process.env.FM_ENVD_JOIN_CLI_BIN;
  assert.ok(
    binary,
    "Compile the explicit live Go helper and pass FM_ENVD_JOIN_CLI_BIN",
  );
  const child = spawn(binary, ["-test.run=^TestHostJoinLiveCLI$", "-test.v"], {
    env: {
      ...process.env,
      FM_HOST_JOIN_LIVE_CLI: "1",
      FM_ENVD_CHAIN_CONNECTION: "1",
      FM_ENVD_NATIVE_DISCOVERY: "1",
      FM_ENVD_NATIVE_APP_EXECUTION: "1",
      FM_ENVD_AGENT_DISCOVERY: "1",
      FM_ENVD_DEVICE_COMMAND: "1",
      FM_ENVD_HANDOVER_APPROVAL: "1",
      FM_ENVD_NATIVE_EXECUTION: "0",
      FM_ENVD_HOST_REJOIN: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  hostProcess = child;
  type Hello = {
    host_address: string;
    coordinator_endpoint: string;
    coordinator_public_key: string;
  };
  const phases = new Map<
    string,
    {
      promise: Promise<any>;
      resolve: (v: any) => void;
      reject: (e: Error) => void;
    }
  >();
  for (const name of [
    "FM_ENVD_HOST_PUBLIC",
    "FM_HOST_JOIN_CLI_RESULT",
    "FM_CHAIN_CONNECTION_RESULT",
  ]) {
    let resolve!: (v: any) => void, reject!: (e: Error) => void;
    const promise = new Promise<any>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    phases.set(name, { promise, resolve, reject });
  }
  let lines = "";
  child.stdout.on("data", (part) => {
    lines += String(part);
    let end: number;
    while ((end = lines.indexOf("\n")) >= 0) {
      const line = lines.slice(0, end);
      lines = lines.slice(end + 1);
      for (const [name, phase] of phases)
        if (line.startsWith(name + " ")) {
          try {
            phase.resolve(JSON.parse(line.slice(name.length + 1)));
          } catch {
            phase.reject(new Error("Malformed public envd phase"));
          }
        }
    }
  });
  child.stderr.on("data", () => {});
  const done = new Promise<void>((yes, no) => {
    child.once("error", no);
    child.once("exit", (code) => {
      hostCompleted = true;
      const error = new Error(
        `envd helper exited (${code}) before all phases; query original requests`,
      );
      for (const p of phases.values()) p.reject(error);
      if (code === 0) yes();
      else no(error);
    });
  });
  void done.catch(() => {});
  child.stdin.write(
    JSON.stringify({
      PackageID: deployment.packageId,
      RegistryID: deployment.registryId,
      OrganizationID: organizationId,
      ChainIdentifier: deployment.chain.chainIdentifier,
      JournalRoot: output + ".journal",
      LiveConnection: true,
    }) + "\n",
  );
  const hello: Hello = await phases.get("FM_ENVD_HOST_PUBLIC")!.promise;
  const admission = new HostAdmission(
    chain,
    device,
    auth.grantId,
    organizationId,
    new MemoryTransactionJournal(),
  );
  const bindingQuote = await admission.prepare(
    {
      kind: "binding",
      endpoint: hello.coordinator_endpoint,
      publicKey: hello.coordinator_public_key,
    },
    randomUUID(),
    true,
  );
  assert.ok(!("status" in bindingQuote));
  await preparedQuote(
    "native registration of actual loopback Coordinator",
    bindingQuote,
  );
  const bindingOutcome = await admission.submit(bindingQuote);
  await record(
    "native registration of actual loopback Coordinator",
    bindingOutcome,
  );
  const bindingId = createdObject(bindingOutcome, "host::CoordinatorBinding");
  await readVisible(
    () => admission.directory(),
    (v) => v.bindings.some((b) => b.id === bindingId),
  );
  const inviteQuote = await admission.prepare(
    {
      kind: "invite",
      bindingId,
      ttlMinutes: 15,
      membershipDays: 1,
      observationHours: 1,
    },
    randomUUID(),
    true,
  );
  assert.ok(!("status" in inviteQuote));
  await preparedQuote("native single-use Host invitation", inviteQuote);
  const inviteOutcome = await admission.submit(inviteQuote);
  await record("native single-use Host invitation", inviteOutcome);
  await readVisible(
    () => admission.directory(),
    (v) =>
      v.invitations.some(
        (i) => i.id === createdObject(inviteOutcome, "host::HostInvite"),
      ),
  );
  const invitation = await admission.createdInvite(inviteOutcome);
  assert.ok(invitation.code);
  await requestSuiFromFaucetV2({ host: faucet, recipient: hello.host_address });
  child.stdin.write(`${invitation.code}\nJOIN ${organizationId}\n`);
  invitation.code = null;
  admission.dispose();
  const joined = await phases.get("FM_HOST_JOIN_CLI_RESULT")!.promise;
  assert.equal(joined.broadcasts, 1);
  assert.equal(joined.result.state, "confirmed");
  assert.equal(joined.result.membership.current_membership, true);
  const member = await readVisible(
    () => admission.directory(),
    (v) => v.memberships.some((m) => m.host_address === hello.host_address),
  );
  const membershipId = member.memberships.find(
    (m) => m.host_address === hello.host_address,
  )!.id;
  state = {
    ...state,
    phase: "real_host_joined",
    bindingId,
    membershipId,
    hostAddress: hello.host_address,
    joinDigest: joined.result.digest,
    hostJoinBroadcasts: joined.broadcasts,
  };
  checks.push(
    "native App registers the actual Coordinator and one-use invitation; production envd CLI persists and queries one lost join receipt without another broadcast",
  );
  await save();
  const reads = new CoordinatorReadClient(
    chain,
    device,
    auth.grantId,
    organizationId,
  );
  const snapshots = await readVisible(
    () => reads.readHosts(bindingId),
    (rows) =>
      rows.some(
        (r) =>
          r.state === "verified" &&
          r.nativeDiscovery?.state === "complete" &&
          r.nativeDiscovery.instances.length === 1,
      ),
  );
  const host = snapshots[0];
  assert.equal(host.state, "verified");
  const instance = host.nativeDiscovery!.instances[0];
  assert.equal(instance.runtime, "bounded-process-v1");
  assert.equal(instance.continuity, "envd-process-v1");
  const selection = {
    bindingId,
    hostAddress: hello.host_address,
    instanceId: instance.instanceId,
    workspaceHash: instance.workspaceHash,
  };
  const importer = new AgentImport(
    chain,
    device,
    auth.grantId,
    organizationId,
    new MemoryTransactionJournal(),
  );
  const importQuote = await importer.prepare(selection, randomUUID(), true);
  assert.ok(!("status" in importQuote));
  await preparedQuote("native import of actual bounded Agent", importQuote);
  const imported = await importer.submit(importQuote);
  assert.ok(imported.status !== "already-imported");
  await record("native import of actual bounded Agent", imported);
  const managed = await importer.confirmed(imported, selection);
  const managedAgentId = managed.id;
  assert.equal(managed.control_confirmed, false);
  checks.push(
    "signed live Host discovery is authenticated by the native device; formal App imports the existing actual native file Agent with observation rights only",
  );
  state = {
    ...state,
    phase: "real_agent_imported",
    managedAgentId,
    instanceId: instance.instanceId,
  };
  await save();
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
    objective: "Produce reviewed documentation on the actual Host",
    successCriteria: "Human independently reviews original file evidence",
    priority: 0,
    deadlineMs: String(Date.now() + 3600000),
    allowedPaths: ["docs"],
    prohibitedActions: ["external network", "no shell"],
    maxCalls: "3",
    krs: [
      {
        title: "Create one exact documentation file",
        unit: "files",
        precision: 0,
        baseline: "0",
        target: "1",
        weight: "1",
        maxAgeMinutes: "5",
        verificationRule: "Inspect actual original file evidence",
      },
    ],
  });
  assert.ok(!("status" in draftQuote));
  await preparedQuote("native encrypted actual Host OKR draft", draftQuote);
  const draftOutcome = await draft.submit(draftQuote);
  await record("native encrypted actual Host OKR draft", draftOutcome);
  const okrId = createdObject(draftOutcome, "okr::Okr");
  state = { ...state, okrId };
  await save();
  const attempt = randomUUID(),
    journal = new MemoryTransactionJournal();
  const setup = new HandoverSetup(
    chain,
    device,
    auth.grantId,
    organizationId,
    managedAgentId,
    attempt,
    invoke,
    journal,
  );
  const observeQuote = await setup.prepare();
  assert.ok(!("status" in observeQuote));
  await preparedQuote("native one-use observation capability", observeQuote);
  const observeOutcome = await setup.submit(observeQuote);
  await record("native one-use observation capability", observeOutcome);
  const observeCapability = await setup.confirmed(observeOutcome);
  const plan: NativeFileOkrPlan = {
    format: 1,
    paths: { "file.read": ["docs"], "file.write": ["docs"] },
    krs: [
      {
        maxCalls: "3",
        files: [
          {
            path: "docs/APPROVED.md",
            content:
              "Actual envd execution from the native FractalMind App controller\n",
          },
        ],
      },
    ],
  };
  const input = await setup.createReview(okrId, observeCapability, plan);
  const reviewTransport: typeof fetch = async (...args) => {
    const response = await fetch(...args);
    if (String(args[0]).endsWith("/command")) {
      const envelope = await response.clone().json();
      const delivery = envelope.result;
      state = {
        ...state,
        originalReviewDelivery: {
          success: delivery?.success,
          ok: delivery?.response?.ok,
          error: delivery?.response?.error,
          executionId: delivery?.response?.execution_id,
        },
      };
      await save();
    }
    return response;
  };
  const review = new HandoverReview(
    chain,
    device,
    auth.grantId,
    organizationId,
    attempt,
    invoke,
    journal,
    reviewTransport,
  );
  const reviewQuote = await review.prepare(input);
  assert.ok(!("status" in reviewQuote));
  await preparedQuote("native exact review ticket and Run", reviewQuote);
  const reviewOutcome = await review.submit(reviewQuote);
  await record("native exact review ticket and Run", reviewOutcome);
  // Object effects can precede dynamic-field pagination. Poll only the same
  // original ticket/Run; an incomplete directory never authorizes delivery.
  const restored = await readVisible(
    () => review.restore(),
    (v) => !!v.run,
  );
  assert.ok(restored.run);
  state = {
    ...state,
    phase: "review_prepared",
    reviewExecutionId: restored.run.id,
    reviewDigest: reviewOutcome.digest,
  };
  await save();
  assert.equal(restored.run.state, 0);
  await review.send(true);
  const reviewRun = await readVisible(
    () => sdk.nodeExecution.getExecution(restored.run!.id),
    (r) => r.state === 2 || r.state === 3,
  );
  state = {
    ...state,
    reviewRunState: reviewRun.state,
    reviewResultId: reviewRun.result_record,
  };
  if (reviewRun.state !== 2) {
    const failure = await new NativeExecutionResults(
      chain,
      device,
      auth.grantId,
      organizationId,
      invoke,
    ).read(reviewRun.id, managedAgentId);
    state = { ...state, originalReviewError: failure.response?.error };
    await save();
    throw new Error(
      "Original Host review explicitly failed; inspect recorded original error without replay",
    );
  }
  const acceptance = await review.readAcceptance();
  assert.equal(acceptance.acceptance.host_address, hello.host_address);
  assert.equal(acceptance.acceptance.instance_id, instance.instanceId);
  checks.push(
    "formal native review ticket is sent through the actual device HTTP Coordinator to production envd; actual Agent reserves its physical slot and publishes the exact signed acceptance on Sui",
  );
  const approval = new HandoverApproval(
    chain,
    device,
    auth.grantId,
    organizationId,
    restored.run.id,
    invoke,
    journal,
  );
  const approvalQuote = await approval.prepare({
    command: input.command,
    nativeFilePlan: plan,
  });
  assert.ok(!("status" in approvalQuote));
  await preparedQuote(
    "native approval of actual Host acceptance",
    approvalQuote,
  );
  const approved = await approval.submit(approvalQuote);
  await record("native approval of actual Host acceptance", approved);
  const okr = await readVisible(
    () => sdk.okr.getOkr(okrId),
    (r) => r.state === 1,
  );
  assert.equal(
    (
      await sdk.nodeExecution.readAgentExecutions(
        organizationId,
        managedAgentId,
      )
    ).executions.length,
    1,
  );
  checks.push(
    "formal native approval atomically activates the current OKR and exact reviewed policy, without preparing or delivering a continuation Run",
  );
  let feeConfirmations = 0,
    deliveries = 0,
    transportCalls = 0;
  const transport: typeof fetch = async (...args) => {
    transportCalls++;
    if (String(args[0]).endsWith("/command")) deliveries++;
    return fetch(...args);
  };
  const runner = new NativeOkrRunner(
    chain,
    device,
    auth.grantId,
    organizationId,
    invoke,
    journal,
    async (q) => {
      feeConfirmations++;
      await preparedQuote("native exact continuation ticket fee", q);
      return true;
    },
    transport,
  );
  const displayed = await runner.describe(okrId);
  assert.deepEqual(displayed.plan, plan);
  assert.equal(
    displayed.spec.objective,
    "Produce reviewed documentation on the actual Host",
  );
  assert.equal(feeConfirmations, 0);
  assert.equal(deliveries, 0);
  const control = new OkrControl(
    chain,
    device,
    auth.grantId,
    organizationId,
    okrId,
    okr.agreement_version,
    okr.next_kr,
    journal,
    () => {},
    {
      okrVersion: displayed.okr.version,
      policyPin: canonical(displayed.policy),
    },
  );
  const controlQuote = await control.prepare();
  assert.ok(!("status" in controlQuote));
  await preparedQuote("formal native single-use KR control fee", controlQuote);
  const controlOutcome = await control.submit(controlQuote);
  await record("formal native single-use KR control fee", controlOutcome);
  const capabilityId = await control.confirmed(controlOutcome);
  await control.use(capabilityId);
  const runInput = { okrId, capabilityId };
  const queued = await runner.step({
    ...runInput,
    createIfMissing: true,
    prepareOnly: true,
  });
  assert.equal(queued.status, "queued");
  assert.ok(queued.executionId);
  assert.equal(feeConfirmations, 1);
  assert.equal(deliveries, 0);
  await record(
    "formal native atomic continuation ticket and queued Run",
    runner.lastSubmission!,
  );
  state = {
    ...state,
    phase: "continuation_queued",
    continuationExecutionId: queued.executionId,
    continuationDigest: queued.transactionDigest,
    ticketRecordId: queued.ticketRecordId,
    capabilityId,
  };
  await save();
  const reopened = new NativeOkrRunner(
    chain,
    device,
    auth.grantId,
    organizationId,
    invoke,
    new MemoryTransactionJournal(),
    async () => {
      throw new Error("Restoring cannot charge a fee");
    },
    transport,
  );
  const original = await reopened.step(runInput);
  assert.equal(original.executionId, queued.executionId);
  assert.equal(original.status, "queued");
  assert.equal(deliveries, 0);
  checks.push(
    "formal native control quotation/issuance and command preparation do not dispatch; a fresh runner with an empty journal restores the same encrypted ticket and queued Run",
  );
  const sent = await runner.step({ ...runInput, releaseQueued: true });
  state = {
    ...state,
    phase: "continuation_sent",
    firstDeliveryStatus: sent.status,
    firstDeliveryReason: sent.reason,
    transportCalls,
    commandDeliveries: deliveries,
  };
  await save();
  const settled = await readVisible(
    () => sdk.nodeExecution.getExecution(queued.executionId!),
    (r) => r.state === 2 && !!r.result_record,
  );
  const observations = await readVisible(
    () => sdk.okr.listObservations(okrId),
    (r) => r.observations.some((o) => o.run_id === settled.id),
  );
  const observed = observations.observations.find(
    (o) => o.run_id === settled.id,
  )!;
  assert.equal(observed.current, "1");
  const current = await sdk.okr.getOkr(okrId),
    budget = await sdk.okr.getBudget(okrId);
  assert.equal(current.state, 1);
  assert.equal(current.metrics[0].verified, false);
  assert.equal(current.next_kr, "0");
  assert.equal(current.metrics[0].run_id, settled.id);
  assert.equal(budget.spent, 3n);
  assert.equal(budget.reserved, 0n);
  const reader = new NativeExecutionResults(
    chain,
    device,
    auth.grantId,
    organizationId,
    invoke,
  );
  const result = await reader.read(settled.id, managedAgentId);
  assert.ok(result.response?.ok);
  const evidence = (
    result.response!.result as {
      evidence: { path: string; verified: boolean }[];
    }
  ).evidence;
  assert.equal(evidence[0].path, "docs/APPROVED.md");
  assert.equal(evidence[0].verified, true);
  assert.equal(result.recordId, settled.result_record);
  const restoredFinal = await reopened.step(runInput);
  assert.equal(restoredFinal.status, "awaiting_verification");
  assert.equal(deliveries, 1);
  assert.equal(feeConfirmations, 1);
  checks.push(
    "explicit continuation reaches the actual production envd and native file adapter exactly once; original encrypted result decrypts through the OS vault, Host measurement is 1 and tool budget is 3 spent/0 reserved",
  );
  checks.push(
    "fresh native runner recovers the original successful Run and measurement without another fee or delivery; KR verification and final Human acceptance remain pending",
  );
  state = {
    ...state,
    resultRecordId: settled.result_record,
    resultCreationDigest: result.transactionDigest,
    observationId: observed.id,
    observedCurrent: observed.current,
    humanVerified: current.metrics[0].verified,
    okrState: current.state,
    budget: { spent: String(budget.spent), reserved: String(budget.reserved) },
    restoredStatus: restoredFinal.status,
    transportCalls,
    commandDeliveries: deliveries,
    feeConfirmations,
  };
  await save();
  const revokeQuote = await admission.prepare(
    { kind: "revoke-member", targetId: membershipId },
    randomUUID(),
    true,
  );
  assert.ok(!("status" in revokeQuote));
  await preparedQuote("native revocation of actual Host", revokeQuote);
  const revoked = await admission.submit(revokeQuote);
  await record("native revocation of actual Host", revoked);
  await readVisible(
    () => sdk.host.getMembership(membershipId),
    (r) => r.revoked,
  );
  child.stdin.write("REVOKED\n");
  state = {
    ...state,
    connectionRevocation: await phases.get("FM_CHAIN_CONNECTION_RESULT")!
      .promise,
  };
  child.stdin.end("DONE\n");
  await done;
  assert.equal(
    (await reader.read(settled.id, managedAgentId)).recordId,
    settled.result_record,
  );
  checks.push(
    "actual on-chain Host revocation rejects Coordinator routing and worker heartbeat; currently authorized Human can still read the immutable original historical result",
  );
  state = {
    ...state,
    phase: "validated_native_app_real_envd",
    hostExitedSuccessfully: true,
  };
} catch (error) {
  state = {
    ...state,
    error: error instanceof Error ? error.message : String(error),
  };
  await save();
  throw error;
} finally {
  if (hostProcess && !hostCompleted) {
    hostProcess.stdin.destroy();
    hostProcess.kill("SIGTERM");
  }
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
