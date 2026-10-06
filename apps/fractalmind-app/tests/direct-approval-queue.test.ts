import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSuiAddress as id } from "@mysten/sui/utils";
import type { ChainReadSession } from "../src/chain";
import type { Agent } from "../src/domain";
import {
  directApprovalStatus,
  readDirectApprovalQueue,
} from "../src/direct-approval-queue";

const org = id("1"),
  agentId = id("2"),
  permissionId = id("3"),
  messageId = id("4"),
  approvalId = id("5"),
  runId = id("6");
function fixture() {
  const managed = {
    id: agentId,
    org_id: org,
    instance_id: `native-${"a".repeat(64)}`,
    version: "1",
    membership_id: id("7"),
    host_address: id("8"),
    control_confirmed: true,
    revoked: false,
  } as Agent;
  const permission = {
    id: permissionId,
    org_id: org,
    managed_agent: agentId,
    version: "2",
    managed_version: "1",
    membership_id: managed.membership_id,
    revoked: false,
    expires_at_ms: "3000",
  };
  const message = {
    id: messageId,
    org_id: org,
    permission_id: permissionId,
    permission_version: "2",
    managed_agent: agentId,
    managed_version: "1",
    membership_id: managed.membership_id,
    writer_device: id("9"),
    human_id: id("f"),
    grant_id: id("a"),
    action: "file.write",
    budget_amount: "3",
    boundary_hash: [1, 2],
    created_at_ms: "1000",
    expires_at_ms: "2500",
  };
  const approval = {
    id: approvalId,
    org_id: org,
    permission_id: permissionId,
    permission_version: "2",
    message_id: messageId,
    managed_agent: agentId,
    managed_version: "1",
    action: "file.write",
    budget_amount: "3",
    boundary_hash: [1, 2],
    state: 0,
    expires_at_ms: "2400",
  };
  const run = {
    id: runId,
    org_id: org,
    managed_agent: agentId,
    membership_id: managed.membership_id,
    host_address: managed.host_address,
    node_id: managed.host_address,
    agent_id: managed.instance_id,
    delegate: message.writer_device,
    human_id: message.human_id,
    grant_id: message.grant_id,
    action: "direct.message",
    scope: "direct",
    budget_amount: "3",
    budget_asset: "TOOL_CALLS",
    state: 2,
    capability_id: id("b"),
    result_record: id("c"),
    result_hash: Array(32).fill(1),
    stop_requested: false,
  };
  const claim = {
    message_id: messageId,
    capability_id: run.capability_id,
    approval_id: approvalId,
    permission_version: "2",
  };
  const options = {
    missing: false,
    failure: false,
    revisionChanged: false,
    executionId: null as string | null,
    runUnavailable: false,
    hasApproval: true,
    networkChanged: false,
    approvalChanged: false,
    runChanged: false,
  };
  let permissionReads = 0,
    networkChecks = 0,
    executionReads = 0,
    writes = 0;
  const sdk = {
    directAgent: {
      findPermissionForAgent: async (_org: string, managedId: string) => {
        if (options.failure || managedId !== agentId)
          throw new Error("unavailable");
        if (options.missing) return null;
        permissionReads++;
        return structuredClone({
          ...permission,
          ...(options.revisionChanged && permissionReads > 1
            ? { version: "3" }
            : {}),
        });
      },
      listMessages: async () => [structuredClone(message)],
      getMessageLinks: async () => ({
        approval: options.hasApproval ? structuredClone(approval) : null,
        executionId: options.executionId,
      }),
      getClaim: async () => structuredClone(claim),
      getApproval: async () =>
        structuredClone({
          ...approval,
          ...(options.approvalChanged ? { state: 1 } : {}),
        }),
      decideApproval: () => {
        writes++;
        throw new Error("must not sign");
      },
      requestApproval: () => {
        writes++;
        throw new Error("must not create");
      },
    },
    nodeExecution: {
      getExecution: async () => {
        if (options.runUnavailable) throw new Error("unavailable");
        executionReads++;
        return structuredClone({
          ...run,
          ...(options.runChanged && executionReads > 1 ? { state: 1 } : {}),
        });
      },
      prepare: () => {
        writes++;
        throw new Error("must not create a Run");
      },
    },
  };
  const chain = {
    sdk,
    checkNetwork: async () => {
      networkChecks++;
      if (options.networkChanged && networkChecks > 1)
        throw new Error("network_changed");
      return "same-chain";
    },
  } as unknown as ChainReadSession;
  return {
    chain,
    managed,
    permission,
    message,
    approval,
    run,
    claim,
    options,
    read: () => readDirectApprovalQueue(chain, org, [managed]),
    counts: () => ({ networkChecks, writes }),
  };
}

test("cold queue restores exact message/approval/version from Sui without signing or creating execution", async () => {
  const f = fixture(),
    queue = await f.read();
  assert.equal(queue.rows.length, 1);
  assert.deepEqual(queue.unavailableAgents, []);
  const [row] = queue.rows;
  assert.equal(row.message.id, messageId);
  assert.equal(row.approval.id, approvalId);
  assert.equal(row.permission.version, "2");
  assert.deepEqual(row.run, { value: null });
  assert.equal(directApprovalStatus(row, 2000n), "pending");
  assert.deepEqual(f.counts(), { networkChecks: 2, writes: 0 });
});

test("missing exact permission is empty; permission failure remains incomplete with known rows intact", async () => {
  const f = fixture();
  f.options.missing = true;
  assert.deepEqual((await f.read()).unavailableAgents, []);
  assert.equal((await f.read()).rows.length, 0);
  f.options.missing = false;
  const queue = await readDirectApprovalQueue(f.chain, org, [
    f.managed,
    { ...f.managed, id: id("d") },
  ]);
  assert.equal(queue.rows.length, 1);
  assert.deepEqual(queue.unavailableAgents, [id("d")]);
});

test("unapproved messages do not become invented pending approvals", async () => {
  const f = fixture();
  f.options.hasApproval = false;
  assert.equal((await f.read()).rows.length, 0);
});

test("permission revision during read is unknown, not a current pending approval", async () => {
  const f = fixture();
  f.options.revisionChanged = true;
  const result = await f.read();
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.unavailableAgents, [agentId]);
});

test("an independent approval decision during read cannot be published as pending with a fresh timestamp", async () => {
  const f = fixture();
  f.options.approvalChanged = true;
  const result = await f.read();
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.unavailableAgents, [agentId]);
});

test("Run progress changing independently during read stays unknown and retains the original Run", async () => {
  const f = fixture();
  f.options.executionId = runId;
  f.options.runChanged = true;
  const row = (await f.read()).rows[0];
  assert.equal(row.executionId, runId);
  assert.equal(row.run.value, null);
  assert.equal(row.run.failure, "execution_unavailable");
});

test("approved zero-tool questions and status requests retain their successful original results", async () => {
  for (const action of ["ask", "status"]) {
    const f = fixture();
    f.options.executionId = runId;
    Object.assign(f.message, { action, budget_amount: "0" });
    Object.assign(f.approval, { action, budget_amount: "0", state: 3 });
    Object.assign(f.run, { budget_amount: "0", budget_asset: "" });
    const row = (await f.read()).rows[0];
    assert.equal(row.run.value?.state, 2);
    assert.equal(row.run.failure, undefined);
  }
});

test("exact approval source/action/bounds cannot be spliced into another request", async () => {
  for (const change of [
    { message_id: id("e") },
    { permission_version: "1" },
    { action: "status" },
    { budget_amount: "9" },
    { boundary_hash: [8, 9] },
    { managed_version: "4" },
  ]) {
    const f = fixture();
    Object.assign(f.approval, change);
    const result = await f.read();
    assert.equal(result.rows.length, 0);
    assert.deepEqual(result.unavailableAgents, [agentId]);
  }
});

test("original execution outcome survives permission changes; unreadable or spliced Run is unknown", async () => {
  const f = fixture();
  f.options.executionId = runId;
  f.approval.state = 3;
  f.permission.version = "3";
  const queue = await f.read(),
    [row] = queue.rows;
  assert.equal(row.run.value?.state, 2);
  assert.equal(row.run.value?.result_record, id("c"));
  assert.equal(directApprovalStatus(row, 4000n), "consumed");
  f.run.delegate = id("e");
  const mismatch = (await f.read()).rows[0];
  assert.equal(mismatch.executionId, runId);
  assert.equal(mismatch.run.value, null);
  assert.equal(mismatch.run.failure, "execution_unavailable");
  f.run.delegate = f.message.writer_device;
  f.options.runUnavailable = true;
  assert.equal((await f.read()).rows[0].run.failure, "execution_unavailable");
});

test("revoked, superseded and expired requests stay visible without counting as actionable pending", async () => {
  const f = fixture(),
    [row] = (await f.read()).rows;
  assert.equal(directApprovalStatus(row, 2400n), "expired");
  assert.equal(
    directApprovalStatus(
      { ...row, permission: { ...row.permission, version: "3" } },
      2000n,
    ),
    "superseded",
  );
  assert.equal(
    directApprovalStatus(
      { ...row, managed: { ...row.managed, revoked: true } },
      2000n,
    ),
    "superseded",
  );
  assert.equal(
    directApprovalStatus(
      { ...row, approval: { ...row.approval, state: 1 } },
      2000n,
    ),
    "approved",
  );
  assert.equal(
    directApprovalStatus(
      { ...row, approval: { ...row.approval, state: 2 } },
      4000n,
    ),
    "rejected",
  );
  assert.equal(
    directApprovalStatus({ ...row, executionId: runId }, 2000n),
    "reconcile",
  );
});

test("an execution marked successful without a bound result never appears as known success", async () => {
  const f = fixture();
  f.options.executionId = runId;
  f.run.result_hash = [];
  const row = (await f.read()).rows[0];
  assert.equal(row.run.value, null);
  assert.equal(row.run.failure, "execution_unavailable");
  assert.equal(directApprovalStatus(row, 2000n), "reconcile");
});

test("different organization, duplicate instances and chain changes cannot publish a queue", async () => {
  const f = fixture();
  await assert.rejects(readDirectApprovalQueue(f.chain, id("e"), [f.managed]));
  await assert.rejects(
    readDirectApprovalQueue(f.chain, org, [f.managed, f.managed]),
  );
  f.options.networkChanged = true;
  await assert.rejects(f.read(), /network_changed/);
});
