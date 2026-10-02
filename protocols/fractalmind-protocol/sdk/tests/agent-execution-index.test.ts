import assert from "node:assert/strict";
import test from "node:test";
import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import { deriveDynamicFieldID } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { FractalMindClient } from "../src/client.js";
import { ManagedAgentBcs } from "../src/host.js";
import {
  AgentExecutionIndexBcs,
  AgentExecutionPointerBcs,
  AgentExecutionReadError,
  CommandExecutionBcs,
  NodeExecutionApi,
} from "../src/node-execution.js";
import { signNodeCommand } from "../src/node-command.js";

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const pkg = id(1),
  org = id(2),
  managedId = id(3),
  host = id(4),
  table = id(5);
const budgetBcs = bcs.struct("Claim", {
  reserved_amount: bcs.u64(),
  spent_amount: bcs.u64(),
  settled: bcs.bool(),
});
function fixture(states: number[], action = "assign") {
  const control = ["assign", "start", "stop", "direct.message"].includes(
    action,
  );
  const amount = 9007199254740993n;
  const managed = {
    id: managedId,
    org_id: org,
    membership_id: id(6),
    host_address: host,
    instance_id: "native-instance",
    runtime: "bounded-process-v1",
    workspace_hash: Array(32).fill(1),
    control_confirmed: true,
    confirmed_by_human: id(7),
    confirmed_by_device: id(8),
    version: "1",
    revoked: false,
    imported_at_ms: "1",
  };
  const runs = states.map((state, i) => ({
    id: id(10 + i),
    org_id: org,
    capability_id: id(20 + i),
    capability_version: "1",
    human_id: id(7),
    grant_id: id(9),
    grant_version: "1",
    membership_id: id(6),
    host_address: host,
    managed_agent: managedId,
    delegate: id(8),
    node_id: host,
    agent_id: managed.instance_id,
    command_id: "command-" + i,
    nonce: "nonce-" + i,
    idempotency_key: "idem-" + i,
    intent_hash: Array(32).fill(i + 1),
    action,
    scope: "observation",
    budget_asset: "TOOL_CALLS",
    budget_amount: amount.toString(),
    issued_at_ms: "1",
    expires_at_ms: "2",
    state,
    cursor: "1",
    stop_requested: state === 5,
    created_at_ms: "1",
    started_at_ms: "1",
    updated_at_ms: "1",
    result_record: [2, 3, 4].includes(state) ? id(30 + i) : null,
    result_hash: [],
    attempt_id: [],
  }));
  const index = {
    executions: { id: table, size: states.length.toString() },
    unsettled_control: states
      .filter((state) => control && ![2, 3, 5].includes(state))
      .length.toString(),
    revision: "1",
  };
  const pointers = runs.map((run) => ({
    capability_id: run.capability_id,
    control,
    settled: [2, 3, 5].includes(run.state),
  }));
  const budgets = runs.map((run) => ({
    reserved_amount: amount,
    spent_amount: [2, 3].includes(run.state) ? 3n : 0n,
    settled: [2, 3, 5].includes(run.state),
  }));
  let mode = "",
    reads = 0;
  const core = {
    getObject: async (input: { objectId: string }) => {
      if (input.objectId === managedId)
        return {
          object: {
            objectId: managedId,
            type: `${pkg}::host::ManagedAgent`,
            owner: { $kind: "Shared" },
            content: ManagedAgentBcs.serialize({
              ...managed,
              version: mode === "managed_changed" && reads > 1 ? "2" : "1",
            }).toBytes(),
          },
        };
      const i = runs.findIndex((run) => run.id === input.objectId);
      assert.ok(i >= 0);
      return {
        object: {
          objectId: runs[i].id,
          type: `${pkg}::node_execution::CommandExecution`,
          owner: { $kind: mode === "owned" ? "AddressOwner" : "Shared" },
          content: CommandExecutionBcs.serialize({
            ...runs[i],
            org_id: mode === "cross_org" ? id(99) : org,
            managed_agent: mode === "cross_instance" ? id(99) : managedId,
          }).toBytes(),
        },
      };
    },
    getDynamicField: async (input: {
      parentId: string;
      name: { type: string; bcs: Uint8Array };
    }) => {
      if (input.parentId === org) {
        reads++;
        assert.equal(input.name.type, `${pkg}::host::AgentExecutionIndexKey`);
        assert.deepEqual(
          input.name.bcs,
          bcs.Address.serialize(managedId).toBytes(),
        );
        if (mode === "absent" || mode === "other_missing")
          throw {
            reason: "notFound",
            objectId: deriveDynamicFieldID(
              org,
              TypeTagSerializer.parseFromStr(input.name.type),
              mode === "absent"
                ? input.name.bcs
                : bcs.Address.serialize(id(99)).toBytes(),
            ),
          };
        if (mode === "rpc") throw new Error("network unavailable");
        return {
          dynamicField: {
            version: "1",
            value: {
              type:
                mode === "wrong_type"
                  ? `${pkg}::host::HostIndex`
                  : `${pkg}::host::AgentExecutionIndex`,
              bcs: AgentExecutionIndexBcs.serialize({
                ...index,
                revision: mode === "ledger_changed" && reads > 1 ? "2" : "1",
                unsettled_control:
                  mode === "wrong_count" ? "0" : index.unsettled_control,
              }).toBytes(),
            },
          },
        };
      }
      if (input.parentId === table) {
        const runId = bcs.Address.parse(input.name.bcs),
          i = runs.findIndex((run) => run.id === runId);
        assert.ok(i >= 0);
        return {
          dynamicField: {
            value: {
              type: `${pkg}::host::AgentExecutionPointer`,
              bcs: AgentExecutionPointerBcs.serialize({
                ...pointers[i],
                settled: mode === "fake_settled" ? true : pointers[i].settled,
                capability_id:
                  mode === "wrong_cap" ? id(99) : pointers[i].capability_id,
              }).toBytes(),
            },
          },
        };
      }
      const i = runs.findIndex((run) => run.capability_id === input.parentId);
      assert.ok(i >= 0);
      return {
        dynamicField: {
          value: {
            type: `${pkg}::remote_authority::BoundBudgetClaim`,
            bcs: budgetBcs
              .serialize({
                ...budgets[i],
                settled:
                  mode === "budget_mismatch"
                    ? !budgets[i].settled
                    : budgets[i].settled,
              })
              .toBytes(),
          },
        },
      };
    },
    listDynamicFields: async (input: {
      parentId: string;
      cursor: string | null;
    }) => {
      assert.equal(input.parentId, table);
      const start = input.cursor ? Number(input.cursor) : 0,
        end = Math.min(start + 2, runs.length);
      return {
        dynamicFields: runs
          .slice(start, mode === "index_lag" ? Math.min(start + 1, end) : end)
          .map((run) => ({
            name: {
              type: "0x2::object::ID",
              bcs: bcs.Address.serialize(run.id).toBytes(),
            },
          })),
        hasNextPage: end < runs.length,
        cursor: end < runs.length ? String(end) : null,
      };
    },
  };
  const api = new NodeExecutionApi(
    new FractalMindClient({
      packageId: id(90),
      originalPackageId: pkg,
      client: { core } as unknown as ClientWithCoreApi,
    }),
  );
  return {
    api,
    setMode: (value: string) => {
      mode = value;
    },
    runs,
  };
}

test("all capability histories and pages retain queued, running and unknown control reservations", async () => {
  const { api } = fixture([0, 1, 4, 2, 3, 5]);
  const result = await api.readAgentExecutions(org, managedId);
  assert.equal(result.executions.length, 6);
  assert.equal(result.unsettledControl, 3);
  assert.deepEqual(
    result.executions.map((row) => row.reserved),
    [9007199254740993n, 9007199254740993n, 9007199254740993n, 0n, 0n, 0n],
  );
  assert.equal(result.executions[2].run.expires_at_ms, "2"); // Expired remains unresolved.
  assert.equal(result.executions[3].spent, 3n);
});
test("lagging pagination cannot omit a queued control even when the directory revision is unchanged", async () => {
  const f = fixture([2, 0]);
  f.setMode("index_lag");
  await assert.rejects(
    f.api.readAgentExecutions(org, managedId),
    (e) => e instanceof AgentExecutionReadError && e.code === "invalid_source",
  );
  f.setMode("");
  const complete = await f.api.readAgentExecutions(org, managedId);
  assert.equal(complete.unsettledControl, 1);
  assert.equal(complete.executions.length, 2);
});
test("observation commands do not block file control handover but remain in history", async () => {
  const { api } = fixture([0, 1, 4, 2], "status");
  const result = await api.readAgentExecutions(org, managedId);
  assert.equal(result.unsettledControl, 0);
  assert.equal(result.executions.length, 4);
  assert.equal(result.executions[2].settled, false);
});
test("missing coverage is distinct from empty history and other unavailable data", async () => {
  const empty = fixture([]);
  assert.equal(
    (await empty.api.readAgentExecutions(org, managedId)).executions.length,
    0,
  );
  for (const mode of ["absent", "other_missing", "rpc"]) {
    const f = fixture([]);
    f.setMode(mode);
    await assert.rejects(f.api.readAgentExecutions(org, managedId), (error) =>
      mode === "absent"
        ? error instanceof AgentExecutionReadError &&
          error.code === "coverage_unavailable"
        : !(error instanceof AgentExecutionReadError),
    );
  }
});
test("source, state, budget and concurrent directory mutations never yield ready", async () => {
  for (const mode of [
    "owned",
    "cross_org",
    "cross_instance",
    "wrong_type",
    "wrong_count",
    "fake_settled",
    "wrong_cap",
    "budget_mismatch",
    "ledger_changed",
    "managed_changed",
  ]) {
    const f = fixture([0, 1, 4]);
    f.setMode(mode);
    await assert.rejects(
      f.api.readAgentExecutions(org, managedId),
      (error) => error instanceof AgentExecutionReadError,
    );
  }
});
test("SDK routes tracked preparation and cancellation through explicit v2 ABI without downgrade", async () => {
  const f = fixture([]);
  const command = await signNodeCommand(Ed25519Keypair.generate(), {
    target: { organizationId: org, nodeId: host, agentId: "native-instance" },
    action: "assign",
    scope: "control",
    capability: { id: id(20), revocationVersion: 1n },
    payload: {},
    budget: { asset: "TOOL_CALLS", amount: 3n },
  });
  const tx = await f.api.prepareCommand({
    humanId: id(7),
    grantId: id(9),
    membershipId: id(6),
    bindingId: id(50),
    managedAgentId: managedId,
    command,
  });
  const call = tx.getData().commands[0].MoveCall!;
  assert.equal(call.module, "node_execution");
  assert.equal(call.function, "prepare_agent_command_v2");
  const stop = f.api.requestStop({
    executionId: id(10),
    capabilityId: id(20),
    organizationId: org,
    humanId: id(7),
    grantId: id(9),
  });
  assert.equal(
    stop.getData().commands[0].MoveCall!.function,
    "request_stop_with_budget_v2",
  );
});
