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
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import type { Transaction } from "@mysten/sui/transactions";
import {
  MemoryTransactionJournal,
  SelfPayTransactionManager,
  signNodeCommand,
  directRequestHash,
  directMessageRecordName,
  type DirectRequest,
  type DirectMessageContext,
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
import { HandoverReview } from "../src/handover-review";
import { HandoverSetup } from "../src/handover-setup";
import { NativeOkrRunner } from "../src/native-okr-runner";
import { OkrControl } from "../src/okr-control";
import { OkrHumanReview, humanReviewIntent } from "../src/okr-human-review";
import { HostAdmission } from "../src/host-admission";
import { AgentImport } from "../src/agent-import";
import {
  CoordinatorReadClient,
  CoordinatorReadError,
} from "../src/coordinator-read";
import { canonical } from "../src/handover-plan";
import { DeviceIdentityVerifier } from "../src/device-identity";
assert.ok(
  process.argv[2] && process.argv[3],
  "Pass isolated deployment and a new output report",
);
const output = process.argv[3],
  progress = output + ".progress.json";
const humanSequence = process.argv.slice(4).includes("--human-sequence");
const directPermission = process.argv.slice(4).includes("--direct-permission");
const directDispatch = process.argv.slice(4).includes("--direct-dispatch");
assert.ok(
  !directDispatch || directPermission,
  "Dispatch needs the direct protocol setup",
);
assert.ok(
  !directPermission || humanSequence,
  "Direct protocol checks run after the reviewed Human sequence",
);
assert.ok(
  process.argv
    .slice(4)
    .every((a) =>
      ["--human-sequence", "--direct-permission", "--direct-dispatch"].includes(
        a,
      ),
    ),
  "Unknown harness option",
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
          humanFinalAcceptanceVerified: state.humanAcceptanceVerified === true,
          directPermissionProtocolVerified:
            state.directPermissionProtocolVerified === true,
          directMessageEnvdDispatchVerified:
            state.directMessageEnvdDispatchVerified === true,
          directMessageUIVerified: false,
          installedHumanReviewVerified: false,
          reviewDecisions: humanSequence
            ? "explicit scripted test approvals, not installed Human UI"
            : "pending",
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
    okrPackageId: deployment.okrPackageId,
    directPackageId: deployment.directPackageId,
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
    const origin =
      suffix.startsWith("okr::") || suffix.startsWith("handover::")
        ? (deployment.okrPackageId ?? deployment.packageId)
        : suffix.startsWith("direct_agent::")
          ? (deployment.directPackageId ?? deployment.packageId)
          : deployment.packageId;
    const matches = result.transaction!.effects.changedObjects.filter(
      (o) =>
        o.idOperation === "Created" &&
        result.transaction!.objectTypes?.[o.objectId] ===
          `${origin}::${suffix}`,
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
      OkrPackageID: deployment.okrPackageId,
      DirectPackageID: deployment.directPackageId,
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
    maxCalls: humanSequence ? "6" : "3",
    krs: Array.from({ length: humanSequence ? 2 : 1 }, (_, index) => ({
      title: `Create exact documentation file ${index + 1}`,
      unit: "files",
      precision: 0,
      baseline: "0",
      target: "1",
      weight: "1",
      maxAgeMinutes: "5",
      verificationRule: "Inspect actual original file evidence",
    })),
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
    krs: Array.from({ length: humanSequence ? 2 : 1 }, (_, index) => ({
      maxCalls: "3",
      files: [
        {
          path: index === 0 ? "docs/APPROVED.md" : "docs/SECOND.md",
          content:
            index === 0
              ? "Actual envd execution from the native FractalMind App controller\n"
              : "Second KR independently reviewed before final acceptance\n",
        },
      ],
    })),
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
  if (humanSequence) {
    const decisions: unknown[] = [],
      krRuns = [settled.id];
    async function verifyCurrent(label: string) {
      const source = await sdk.okr.getOkr(okrId);
      const human = new OkrHumanReview(
        chain,
        device,
        auth.grantId,
        organizationId,
        okrId,
        humanReviewIntent(source),
        invoke,
        journal,
      );
      const view = await human.read();
      assert.equal(view.evidence.length, 1);
      assert.equal(
        view.evidence[0].result.run.id,
        krRuns[Number(source.next_kr)],
      );
      assert.equal(
        view.evidence[0].files[0].expectedHash,
        view.evidence[0].files[0].observedHash,
      );
      const beforeDeliveries = deliveries,
        beforeFees = feeConfirmations;
      await assert.rejects(
        human.prepare(view, {
          reviewed: false,
          reason: "Scripted test has not yet confirmed evidence",
        }),
        /confirmation_required/,
      );
      const q = await human.prepare(view, {
        reviewed: true,
        reason: `Explicit scripted Human review of ${label}: original Run, file content and SHA-256 match the approved specification.`,
      });
      assert.ok(!("status" in q));
      assert.equal(deliveries, beforeDeliveries);
      await preparedQuote(label, q);
      const outcome = await human.submit(q);
      await record(label, outcome);
      const confirmed = await human.confirmed(outcome);
      assert.equal(confirmed.okr.state, 1);
      assert.equal(confirmed.okr.next_kr, String(BigInt(source.next_kr) + 1n));
      assert.equal(
        confirmed.okr.metrics[Number(source.next_kr)].verified,
        true,
      );
      assert.equal(deliveries, beforeDeliveries);
      assert.equal(feeConfirmations, beforeFees);
      // Even with a stale view, a known request only returns its original receipt.
      const original = await human.prepare(view, {
        reviewed: false,
        reason: "",
      });
      assert.ok("status" in original);
      assert.equal(original.digest, outcome.digest);
      decisions.push({
        krIndex: source.next_kr,
        requestId: human.requestId,
        digest: outcome.digest,
        verificationRecordId: confirmed.record.id,
        runId: view.evidence[0].result.run.id,
      });
      state = {
        ...state,
        phase: "human_kr_verified",
        humanDecisions: decisions,
        nextKr: confirmed.okr.next_kr,
      };
      await save();
      return confirmed.okr;
    }
    const afterFirst = await verifyCurrent(
      "native independent KR 1 verification",
    );
    assert.equal((await sdk.okr.listExecutions(okrId)).executions.length, 1);
    const nextDescription = await runner.describe(okrId);
    const nextControl = new OkrControl(
      chain,
      device,
      auth.grantId,
      organizationId,
      okrId,
      afterFirst.agreement_version,
      afterFirst.next_kr,
      journal,
      () => {},
      {
        okrVersion: nextDescription.okr.version,
        policyPin: canonical(nextDescription.policy),
      },
    );
    const nextQuote = await nextControl.prepare();
    assert.ok(!("status" in nextQuote));
    await preparedQuote("native second KR explicit control fee", nextQuote);
    const nextOutcome = await nextControl.submit(nextQuote);
    await record("native second KR explicit control fee", nextOutcome);
    const nextCapability = await nextControl.confirmed(nextOutcome);
    await nextControl.use(nextCapability);
    const nextInput = { okrId, capabilityId: nextCapability };
    const nextQueued = await runner.step({
      ...nextInput,
      createIfMissing: true,
      prepareOnly: true,
    });
    assert.equal(nextQueued.status, "queued");
    assert.ok(nextQueued.executionId);
    assert.equal(deliveries, 1);
    await record(
      "native second KR exact ticket and Run",
      runner.lastSubmission!,
    );
    state = {
      ...state,
      phase: "second_kr_queued",
      secondExecutionId: nextQueued.executionId,
      secondPreparationDigest: nextQueued.transactionDigest,
    };
    await save();
    await runner.step({ ...nextInput, releaseQueued: true });
    const second = await readVisible(
      () => sdk.nodeExecution.getExecution(nextQueued.executionId!),
      (r) => r.state === 2 && !!r.result_record,
    );
    await readVisible(
      () => sdk.okr.getOkr(okrId),
      (r) => r.metrics[1].run_id === second.id && r.metrics[1].current === "1",
    );
    krRuns.push(second.id);
    assert.equal(deliveries, 2);
    assert.equal(feeConfirmations, 2);
    const afterSecond = await verifyCurrent(
      "native independent KR 2 verification",
    );
    assert.equal(afterSecond.next_kr, "2");
    assert.equal(afterSecond.state, 1);
    const final = new OkrHumanReview(
      chain,
      device,
      auth.grantId,
      organizationId,
      okrId,
      humanReviewIntent(afterSecond),
      invoke,
      journal,
    );
    const all = await final.read();
    assert.equal(all.evidence.length, 2);
    assert.ok(
      all.evidence.every((e) =>
        e.priorVerification?.reason.includes("Explicit scripted Human review"),
      ),
    );
    assert.notEqual(
      all.evidence[0].priorVerification!.recordId,
      all.evidence[1].priorVerification!.recordId,
    );
    await assert.rejects(
      final.prepare(all, {
        reviewed: false,
        reason: "All KR records are present",
      }),
      /confirmation_required/,
    );
    const finalQuote = await final.prepare(all, {
      reviewed: true,
      reason:
        "Explicit scripted final acceptance: both exact documentation files and their independent KR verification records satisfy the overall success criteria.",
    });
    assert.ok(!("status" in finalQuote));
    await preparedQuote("native separate final Human acceptance", finalQuote);
    assert.equal((await sdk.okr.getOkr(okrId)).state, 1);
    const finalOutcome = await final.submit(finalQuote);
    await record("native separate final Human acceptance", finalOutcome);
    const accepted = await final.confirmed(finalOutcome),
      total = await sdk.okr.getBudget(okrId);
    assert.equal(accepted.okr.state, 3);
    assert.equal(accepted.okr.accepted_by_human, chain.profile.humanId);
    assert.equal(
      accepted.okr.agreement_version,
      String(BigInt(afterSecond.agreement_version) + 1n),
    );
    assert.equal(total.spent, 6n);
    assert.equal(total.reserved, 0n);
    assert.equal(deliveries, 2);
    assert.equal((await sdk.okr.listExecutions(okrId)).executions.length, 2);
    checks.push(
      "two real envd KR Runs are explicitly released in order; native Human verification advances the cursor without another dispatch or implicit acceptance",
    );
    checks.push(
      "final native review reads both original results and separate immutable verification revisions; an explicit, separately quoted Human decision achieves the OKR on Sui",
    );
    state = {
      ...state,
      phase: "human_sequence_accepted",
      secondExecutionId: second.id,
      secondResultRecordId: second.result_record,
      humanAcceptanceVerified: true,
      humanVerified: true,
      okrState: accepted.okr.state,
      nextKr: accepted.okr.next_kr,
      acceptanceRecordId: accepted.record.id,
      acceptanceDigest: finalOutcome.digest,
      historicalVerificationRecordIds: all.evidence.map(
        (e) => e.priorVerification!.recordId,
      ),
      humanDecisions: decisions,
      krExecutionIds: krRuns,
      budget: { spent: String(total.spent), reserved: String(total.reserved) },
      transportCalls,
      commandDeliveries: deliveries,
      feeConfirmations,
    };
    await save();
  }
  if (directPermission) {
    // Protocol/SDK proof with actual OS crypto. This is not a formal direct UI
    // controller or a claim of direct.message dispatch by envd.
    const verifier = new DeviceIdentityVerifier(chain, device, auth.grantId);
    const directManager = new SelfPayTransactionManager({
      client: sdk.client.client,
      network: "localnet",
      signer: device,
      journal,
    });
    const target = { ...auth, membershipId, bindingId, managedAgentId };
    const expiry = Date.now() + 900000;
    async function encrypt(
      kind: number,
      logicalId: string,
      revision: string,
      value: unknown,
    ) {
      const before = await verifier.verifyOrganization(
        organizationId,
        "approve",
      );
      assert.ok(before.encryptedKeys);
      const ciphertext = await invoke("fm_device_encrypt_record", {
        profile,
        record: JSON.stringify({
          network: "localnet",
          encryptedKeys: before.encryptedKeys,
          organizationId,
          kind,
          logicalId,
          revision,
          keyVersion: "1",
          plaintext: toBase64(new TextEncoder().encode(JSON.stringify(value))),
        }),
      });
      assert.equal(typeof ciphertext, "string");
      assert.equal(
        (await verifier.verifyOrganization(organizationId, "approve"))
          .authorityPin,
        before.authorityPin,
      );
      return fromBase64(ciphertext as string);
    }
    async function submitDirect(label: string, transaction: Transaction) {
      const quote = await directManager.prepare({
        requestId: `direct-test:${randomUUID()}`,
        transaction,
        gasBudget: 200000000n,
      });
      await preparedQuote(label, quote);
      const outcome = await directManager.submit(quote);
      await record(label, outcome);
      return outcome;
    }
    const actions = ["status", "file.read", "file.write"] as const;
    const permissionBody = {
      schema: "fractalmind.standing-permission.v1",
      managedAgentId,
      actions,
      paths: plan.paths,
      budgetLimit: "6",
      maxCalls: "3",
      expiresAtMs: expiry,
    };
    const permissionOutcome = await submitDirect(
      "native standing permission creation",
      sdk.directAgent.createPermission({
        ...target,
        actions: [...actions],
        paths: plan.paths,
        maxCalls: "3",
        budgetLimit: "6",
        expiresAtMs: expiry,
        keyVersion: "1",
        encryptedBody: await encrypt(
          2,
          `standing-${managedAgentId}-permission`,
          "1",
          permissionBody,
        ),
      }),
    );
    const permissionId = createdObject(
      permissionOutcome,
      "direct_agent::StandingPermission",
    );
    const policy = await readVisible(
      () =>
        sdk.directAgent.getPermissionForAgent(organizationId, managedAgentId),
      (p) => p.id === permissionId,
    );
    assert.equal(policy.host_address, hello.host_address);
    const ordinaryCapOutcome = await submitDirect(
      "native standing direct capability",
      sdk.directAgent.issueCapability({
        ...target,
        permissionId,
        expectedVersion: "1",
        expiresAtMs: expiry,
      }),
    );
    const ordinaryCapId = createdObject(
      ordinaryCapOutcome,
      "remote_authority::RemoteCapability",
    );
    async function createMessage(
      token: string,
      calls: string,
      options: {
        version?: string;
        action?: "file.write" | "file.read" | "status";
        task?: string;
      } = {},
    ) {
      const action = options.action ?? "file.write";
      const task =
        options.task ??
        JSON.stringify({
          kind: "ensure_text_files",
          files: [{ path: "docs/DIRECT.md", content: "Native direct request" }],
        });
      const request: DirectRequest = {
        message: "Write the reviewed direct-message test file",
        ...(task ? { task } : {}),
        bounds: { paths: plan.paths, max_calls: calls },
      };
      const messageExpiry = Date.now() + 120000;
      const outcome = await submitDirect(
        `native encrypted direct message ${calls}`,
        sdk.directAgent.createMessage({
          ...target,
          permissionId,
          expectedVersion: options.version ?? "1",
          conversationId: "native-direct",
          messageToken: token,
          action,
          paths: plan.paths,
          budgetAmount: calls,
          requestHash: directRequestHash(request, action),
          expiresAtMs: messageExpiry,
          keyVersion: "1",
          encryptedBody: await encrypt(6, directMessageRecordName(token), "1", {
            schema: "fractalmind.direct-request.v1",
            ...request,
            action,
          }),
        }),
      );
      const messageId = createdObject(outcome, "direct_agent::Message");
      const message = await readVisible(
        () => sdk.directAgent.getMessage(messageId),
        (m) => m.id === messageId,
      );
      const publicRecord = await sdk.productRecord.getRecord(
        message.encrypted_record,
      );
      const source = await verifier.verifyOrganization(organizationId, "read");
      const plaintext = await invoke("fm_device_decrypt_record", {
        profile,
        record: JSON.stringify({
          network: "localnet",
          encryptedKeys: source.encryptedKeys,
          organizationId,
          kind: 6,
          logicalId: directMessageRecordName(token),
          revision: "1",
          keyVersion: "1",
          encryptedBody: toBase64(Uint8Array.from(publicRecord.encrypted_body)),
        }),
      });
      const decoded = fromBase64(plaintext as string);
      try {
        assert.equal(
          JSON.parse(new TextDecoder().decode(decoded)).message,
          request.message,
        );
      } finally {
        decoded.fill(0);
      }
      return { request, message };
    }
    async function commandFor(
      source: Awaited<ReturnType<typeof createMessage>>,
      capabilityId: string,
      approval?: { id: string; grant: string },
    ) {
      const context: DirectMessageContext = {
        version: "1",
        permission_id: permissionId,
        permission_version: source.message.permission_version,
        message_id: source.message.id,
        conversation_id: source.message.conversation_id,
        message_token: source.message.message_token,
        message_record_id: source.message.encrypted_record,
        action: source.message.action as "file.write" | "file.read" | "status",
        ...(approval
          ? { approval_id: approval.id, approving_grant_id: approval.grant }
          : {}),
      };
      return signNodeCommand(device, {
        target: {
          organizationId,
          nodeId: hello.host_address,
          agentId: instance.instanceId,
        },
        action: "direct.message",
        scope: "direct",
        capability: { id: capabilityId, revocationVersion: 1n },
        ...(BigInt(source.message.budget_amount) > 0n
          ? {
              budget: {
                asset: "TOOL_CALLS",
                amount: BigInt(source.message.budget_amount),
              },
            }
          : {}),
        issuedAtMs: Date.now(),
        expiresAtMs: Number(source.message.expires_at_ms),
        payload: { ...source.request, direct: context },
      });
    }
    const ordinary = await createMessage(randomUUID(), "3"),
      ordinaryCommand = await commandFor(ordinary, ordinaryCapId);
    const ordinaryPrepared = await submitDirect(
      "native original direct Run preparation",
      await sdk.nodeExecution.prepareCommand({
        ...target,
        command: ordinaryCommand,
      }),
    );
    const ordinaryRunId = createdObject(
      ordinaryPrepared,
      "node_execution::CommandExecution",
    );
    const claim = await readVisible(
      () => sdk.directAgent.getClaim(permissionId, ordinaryRunId),
      (c) => c.reserved === "3",
    );
    assert.equal(claim.settled, false);
    assert.equal(
      (await sdk.directAgent.getPermission(permissionId)).reserved,
      "3",
    );
    await submitDirect(
      "native queued direct cancellation",
      sdk.directAgent.requestStop({
        ...auth,
        permissionId,
        executionId: ordinaryRunId,
        capabilityId: ordinaryCapId,
      }),
    );
    await readVisible(
      () => sdk.directAgent.getPermission(permissionId),
      (p) => p.reserved === "0",
    );
    await readVisible(
      () => sdk.nodeExecution.getExecution(ordinaryRunId),
      (r) => r.state === 5,
    );
    const exception = await createMessage(randomUUID(), "5");
    const approvalToken = directMessageRecordName(
      exception.message.message_token,
      true,
    );
    const requested = await submitDirect(
      "native exact one-off approval request",
      sdk.directAgent.requestApproval({
        ...target,
        permissionId,
        messageId: exception.message.id,
        keyVersion: "1",
        encryptedBody: await encrypt(3, approvalToken, "1", {
          messageId: exception.message.id,
          requestedCalls: "5",
        }),
      }),
    );
    const directApprovalId = createdObject(requested, "direct_agent::Approval");
    await submitDirect(
      "native explicit one-off approval",
      sdk.directAgent.decideApproval({
        ...target,
        permissionId,
        approvalId: directApprovalId,
        messageId: exception.message.id,
        approve: true,
        keyVersion: "1",
        encryptedBody: await encrypt(3, approvalToken, "2", {
          messageId: exception.message.id,
          approved: true,
          reason: "Explicit scripted test exception without standing expansion",
        }),
      }),
    );
    const approvedCap = await submitDirect(
      "native one-off direct capability",
      sdk.directAgent.issueApprovedCapability({
        ...target,
        permissionId,
        approvalId: directApprovalId,
        messageId: exception.message.id,
        approvingGrantId: auth.grantId,
      }),
    );
    const approvedCapId = createdObject(
      approvedCap,
      "remote_authority::RemoteCapability",
    );
    const approvedCommand = await commandFor(exception, approvedCapId, {
      id: directApprovalId,
      grant: auth.grantId,
    });
    const exceptionPrepared = await submitDirect(
      "native one-off approval consumption",
      await sdk.nodeExecution.prepareCommand({
        ...target,
        command: approvedCommand,
      }),
    );
    const exceptionRunId = createdObject(
      exceptionPrepared,
      "node_execution::CommandExecution",
    );
    await readVisible(
      () => sdk.directAgent.getApproval(directApprovalId),
      (a) => a.state === 3,
    );
    const consumed = await readVisible(
      () => sdk.directAgent.getPermission(permissionId),
      (p) => p.approved_reserved === "5",
    );
    assert.equal(consumed.budget_limit, "6");
    assert.equal(consumed.spent, "0");
    assert.equal(consumed.reserved, "0");
    assert.equal(consumed.approved_reserved, "5");
    await submitDirect(
      "native standing permission version change",
      sdk.directAgent.updatePermission({
        ...target,
        permissionId,
        expectedVersion: "1",
        actions: [...actions],
        paths: plan.paths,
        maxCalls: "3",
        budgetLimit: "6",
        expiresAtMs: expiry,
        keyVersion: "1",
        encryptedBody: await encrypt(
          2,
          `standing-${managedAgentId}-permission`,
          "2",
          { ...permissionBody, version: "2" },
        ),
      }),
    );
    const changedPermission = await readVisible(
      () => sdk.directAgent.getPermission(permissionId),
      (p) => p.version === "2",
    );
    assert.equal(changedPermission.approved_reserved, "5");
    await assert.rejects(
      sdk.nodeExecution.prepareCommand({ ...target, command: approvedCommand }),
      /context changed/,
    );
    await submitDirect(
      "native historical direct cancellation after policy change",
      sdk.directAgent.requestStop({
        ...auth,
        permissionId,
        executionId: exceptionRunId,
        capabilityId: approvedCapId,
      }),
    );
    const finalPermission = await readVisible(
      () => sdk.directAgent.getPermission(permissionId),
      (p) => p.version === "2" && p.approved_reserved === "0",
    );
    assert.equal(finalPermission.approved_reserved, "0");
    assert.equal(finalPermission.approved_spent, "0");
    assert.equal(finalPermission.version, "2");
    assert.equal((await sdk.directAgent.listMessages(permissionId)).length, 2);
    assert.equal((await sdk.okr.getBudget(okrId)).spent, 6n);
    assert.equal(deliveries, 2);
    checks.push(
      "actual OS-encrypted direct messages and versioned standing permission rebuild from Sui; ordinary and explicit one-off Run reservations use separate ledgers and can be cancelled historically after a policy change, without direct dispatch or OKR budget changes",
    );
    state = {
      ...state,
      directPermissionProtocolVerified: true,
      directPermissionId: permissionId,
      directMessageIds: [ordinary.message.id, exception.message.id],
      directRunIds: [ordinaryRunId, exceptionRunId],
      directApprovalId,
      directPermissionVersion: finalPermission.version,
      directFinalBudget: {
        spent: finalPermission.spent,
        reserved: finalPermission.reserved,
        approvedSpent: finalPermission.approved_spent,
        approvedReserved: finalPermission.approved_reserved,
      },
    };
    await save();
    if (directDispatch) {
      const results = new NativeCommandResults(
        chain,
        device,
        auth.grantId,
        organizationId,
        invoke,
      );
      const transportClient = new CoordinatorReadClient(
        chain,
        device,
        auth.grantId,
        organizationId,
        transport,
      );
      const issued = await submitDirect(
        "native runtime direct capability v2",
        sdk.directAgent.issueCapability({
          ...target,
          permissionId,
          expectedVersion: "2",
          expiresAtMs: expiry,
        }),
      );
      const cap = createdObject(issued, "remote_authority::RemoteCapability");
      const liveRuns: string[] = [];
      async function executeDirect(
        source: Awaited<ReturnType<typeof createMessage>>,
        capabilityId: string,
        expectedSpent: string,
        approval?: { id: string; grant: string },
      ) {
        const command = await commandFor(source, capabilityId, approval);
        const prepared = await results.prepare({
          command,
          membershipId,
          bindingId,
          managedAgentId,
        });
        await prepared.assertCurrent();
        const created = await submitDirect(
          "native direct Run and OS-wrapped result key",
          prepared.transaction,
        );
        const runId = createdObject(
          created,
          "node_execution::CommandExecution",
        );
        await readVisible(
          () => sdk.nodeExecution.getExecution(runId),
          (r) => r.state === 0,
        );
        state = {
          ...state,
          originalDirectDelivery: {
            runId,
            messageId: source.message.id,
            capabilityId,
            fingerprint: source.message.request_hash,
            phase: "prepared_not_sent",
          },
        };
        await save();
        const request = await transportClient.prepareCommand(
          bindingId,
          command,
        );
        const currentRecipient = await results.preflight({
          command,
          membershipId,
          bindingId,
          managedAgentId,
        });
        await currentRecipient();
        state = {
          ...state,
          originalDirectDelivery: {
            runId,
            messageId: source.message.id,
            capabilityId,
            phase: "sending_once",
          },
        };
        await save();
        try {
          const reply = (await request.send()) as {
            success?: boolean;
            error_code?: string;
            error?: string;
          };
          state = {
            ...state,
            directRelayReply: {
              success: reply.success,
              code: reply.error_code,
              error: reply.error,
            },
          };
          await save();
          if (!reply.success)
            throw new Error(
              `Direct envd rejected original Run: ${reply.error_code}: ${reply.error}`,
            );
        } catch (error) {
          if (
            !(error instanceof CoordinatorReadError) ||
            error.code !== "command_outcome_unknown"
          )
            throw error;
          state = {
            ...state,
            directTransportOutcome: "unknown_query_original_only",
          };
          await save();
        }
        const finished = await readVisible(
          () => sdk.nodeExecution.getExecution(runId),
          (r) => r.state >= 2,
        );
        assert.equal(finished.state, 2);
        const claim = await readVisible(
          () => sdk.directAgent.getClaim(permissionId, runId),
          (c) =>
            c.settled &&
            c.spent === expectedSpent &&
            c.reserved === source.message.budget_amount,
        );
        assert.equal(claim.spent, expectedSpent);
        // An immutable claim retains its original allowance; settled and the
        // aggregate ledger, rather than rewriting that allowance, release it.
        assert.equal(claim.reserved, source.message.budget_amount);
        assert.equal(claim.settled, true);
        await readVisible(
          () => sdk.directAgent.getPermission(permissionId),
          (p) => (approval ? p.approved_reserved === "0" : p.reserved === "0"),
        );
        const decoded = await reader.read(runId, managedAgentId);
        assert.ok(decoded.response?.ok);
        assert.equal(decoded.response!.operation, "direct.message");
        assert.equal(decoded.recordId, finished.result_record);
        liveRuns.push(runId);
        state = {
          ...state,
          originalDirectDelivery: {
            runId,
            phase: "confirmed_original_result",
            resultId: decoded.recordId,
            creationDigest: decoded.transactionDigest,
          },
          directRuntimeRuns: liveRuns,
          transportCalls,
          commandDeliveries: deliveries,
        };
        await save();
        return { command, finished, decoded };
      }
      const write = await createMessage(randomUUID(), "3", {
        version: "2",
        task: JSON.stringify({
          kind: "ensure_text_files",
          files: [
            {
              path: "docs/DIRECT-RUNTIME.md",
              content: "Real direct execution through envd",
            },
          ],
        }),
      });
      const first = await executeDirect(write, cap, "3");
      const writeEvidence = first.decoded.response!.result as {
        evidence: { path: string; verified: boolean }[];
      };
      assert.equal(writeEvidence.evidence[0].path, "docs/DIRECT-RUNTIME.md");
      assert.equal(writeEvidence.evidence[0].verified, true);
      const beforeReplay = await sdk.directAgent.getPermission(permissionId);
      const replay = await transportClient.prepareCommand(
        bindingId,
        first.command,
      );
      await replay.send();
      const afterReplay = await sdk.directAgent.getPermission(permissionId);
      assert.deepEqual(
        [afterReplay.spent, afterReplay.reserved],
        [beforeReplay.spent, beforeReplay.reserved],
      );
      assert.equal(
        (await sdk.nodeExecution.getExecution(first.finished.id)).result_record,
        first.finished.result_record,
      );
      const read = await createMessage(randomUUID(), "1", {
        version: "2",
        action: "file.read",
        task: JSON.stringify({
          kind: "inspect_text_files",
          paths: ["docs/DIRECT-RUNTIME.md"],
        }),
      });
      const readResult = await executeDirect(read, cap, "1");
      assert.equal(
        (
          readResult.decoded.response!.result as {
            results: { content: string }[];
          }
        ).results[0].content,
        "Real direct execution through envd",
      );
      const status = await createMessage(randomUUID(), "0", {
        version: "2",
        action: "status",
        task: "",
      });
      const statusResult = await executeDirect(status, cap, "0");
      assert.equal(
        (
          statusResult.decoded.response!.result as {
            instance_id: string;
            physical_state: string;
          }
        ).instance_id,
        instance.instanceId,
      );
      assert.equal(
        (statusResult.decoded.response!.result as { physical_state: string })
          .physical_state,
        "idle",
      );
      const over = await createMessage(randomUUID(), "5", {
        version: "2",
        task: JSON.stringify({
          kind: "ensure_text_files",
          files: [
            {
              path: "docs/DIRECT-APPROVED.md",
              content: "Real explicitly approved direct execution",
            },
          ],
        }),
      });
      await assert.rejects(
        commandFor(over, cap).then((c) =>
          sdk.nodeExecution.prepareCommand({ ...target, command: c }),
        ),
      );
      const approvalName = directMessageRecordName(
        over.message.message_token,
        true,
      );
      const requested = await submitDirect(
        "native runtime exception request",
        sdk.directAgent.requestApproval({
          ...target,
          permissionId,
          messageId: over.message.id,
          keyVersion: "1",
          encryptedBody: await encrypt(3, approvalName, "1", {
            messageId: over.message.id,
            requestedCalls: "5",
          }),
        }),
      );
      const approvalId = createdObject(requested, "direct_agent::Approval");
      await submitDirect(
        "native runtime explicit exception",
        sdk.directAgent.decideApproval({
          ...target,
          permissionId,
          approvalId,
          messageId: over.message.id,
          approve: true,
          keyVersion: "1",
          encryptedBody: await encrypt(3, approvalName, "2", {
            messageId: over.message.id,
            approved: true,
            reason: "Explicit isolated execution test",
          }),
        }),
      );
      const exceptionCap = await submitDirect(
        "native runtime one-off capability",
        sdk.directAgent.issueApprovedCapability({
          ...target,
          permissionId,
          approvalId,
          messageId: over.message.id,
          approvingGrantId: auth.grantId,
        }),
      );
      const exceptionCapability = createdObject(
        exceptionCap,
        "remote_authority::RemoteCapability",
      );
      await executeDirect(over, exceptionCapability, "3", {
        id: approvalId,
        grant: auth.grantId,
      });
      const budget = await readVisible(
        () => sdk.directAgent.getPermission(permissionId),
        (p) =>
          p.spent === "4" &&
          p.reserved === "0" &&
          p.approved_spent === "3" &&
          p.approved_reserved === "0",
      );
      assert.equal(budget.budget_limit, "6");
      assert.equal(budget.max_calls, "3");
      assert.equal((await sdk.okr.getBudget(okrId)).spent, 6n);
      assert.equal((await sdk.okr.getBudget(okrId)).reserved, 0n);
      checks.push(
        "actual OS-signed direct write, read and zero-tool status traverse authenticated Coordinator to production envd; original encrypted results decrypt through the OS vault",
      );
      checks.push(
        "exact direct replay reuses the original Run and immutable result without another tool spend; explicit five-call approval spends three and refunds two in its separate ledger, without changing the six-call OKR ledger",
      );
      state = {
        ...state,
        directMessageEnvdDispatchVerified: true,
        directRuntimeRuns: liveRuns,
        directFinalBudget: {
          spent: budget.spent,
          reserved: budget.reserved,
          approvedSpent: budget.approved_spent,
          approvedReserved: budget.approved_reserved,
        },
        transportCalls,
        commandDeliveries: deliveries,
      };
      await save();
    }
  }
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
