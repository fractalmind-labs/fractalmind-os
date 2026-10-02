import assert from "node:assert/strict";
import test from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { FractalMindSDK } from "../src/index.js";
import {
  DirectAgentApi,
  DirectApprovalBcs,
  DirectMessageBcs,
  StandingPermissionBcs,
  directRequestHash,
  parseDirectMessageContext,
  type DirectRequest,
} from "../src/direct-agent.js";
import { HostMembershipBcs, ManagedAgentBcs } from "../src/host.js";
import { executionBoundaryHash } from "../src/execution-boundary.js";
import { signNodeCommand } from "../src/node-command.js";

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const now = 1700000000000;
const paths = { "file.write": ["docs"], "file.read": ["docs"] };
const request: DirectRequest = {
  message: "写入验收文件",
  task: JSON.stringify({
    kind: "ensure_text_files",
    files: [{ path: "docs/approved.md", content: "approved" }],
  }),
  bounds: { paths, max_calls: "3" },
};
const body = Uint8Array.from([70, 77, 69, 49, ...new Array(32).fill(0)]);
const Table = (n: number, size = 0) => ({ id: id(n), size: String(size) });
const PermissionBinding = bcs.struct("PermissionCapability", {
  permission_id: bcs.Address,
  permission_version: bcs.u64(),
  approval_id: bcs.option(bcs.Address),
});
function fixture(approved = false) {
  const signer = Ed25519Keypair.generate(),
    device = signer.toSuiAddress();
  const permission = {
    id: id(4),
    org_id: id(2),
    owner_human: id(3),
    human_generation: "1",
    managed_agent: id(5),
    managed_version: "2",
    membership_id: id(6),
    membership_version: "1",
    host_address: id(11),
    workspace_hash: new Array(32).fill(7),
    version: "1",
    revoked: false,
    allowed_actions: ["ask", "status", "file.read", "file.write"],
    boundary_hash: Array.from(executionBoundaryHash(paths)),
    max_calls: "3",
    budget_limit: "6",
    spent: "0",
    reserved: "0",
    approved_spent: "0",
    approved_reserved: "0",
    expires_at_ms: String(now + 120000),
    approved_device: device,
    approved_grant: id(7),
    permission_record: id(20),
    record_revision: "1",
    messages: Table(21, 1),
    approvals: Table(22, approved ? 1 : 0),
    message_runs: Table(23),
    claims: Table(24),
  };
  const message = {
    id: id(8),
    org_id: id(2),
    permission_id: id(4),
    permission_version: "1",
    managed_agent: id(5),
    managed_version: "2",
    membership_id: id(6),
    conversation_id: "conv-1",
    message_token: "msg-1",
    action: "file.write",
    boundary_hash: Array.from(executionBoundaryHash(paths)),
    budget_amount: "3",
    request_hash: Array.from(directRequestHash(request, "file.write")),
    human_id: id(3),
    human_generation: "1",
    writer_device: device,
    grant_id: id(7),
    grant_version: "1",
    created_at_ms: String(now - 1),
    expires_at_ms: String(now + 60000),
    encrypted_record: id(25),
  };
  const managed = {
    id: id(5),
    org_id: id(2),
    membership_id: id(6),
    host_address: id(11),
    instance_id: "native-fixed-instance",
    runtime: "bounded-process-v1",
    workspace_hash: new Array(32).fill(7),
    control_confirmed: true,
    confirmed_by_human: id(3),
    confirmed_by_device: device,
    version: "2",
    revoked: false,
    imported_at_ms: "1",
  };
  const member = {
    id: id(6),
    org_id: id(2),
    host_address: id(11),
    host_public_key: new Array(32).fill(1),
    encryption_public_key: new Array(32).fill(2),
    name: "Host",
    coordinator_binding: id(12),
    version: "1",
    revoked: false,
    expires_at_ms: String(now + 120000),
    joined_at_ms: "1",
    source_invite: id(13),
    observation_capability: id(14),
  };
  const approval = {
    id: id(9),
    org_id: id(2),
    permission_id: id(4),
    permission_version: "1",
    message_id: id(8),
    managed_agent: id(5),
    managed_version: "2",
    action: "file.write",
    boundary_hash: message.boundary_hash,
    budget_amount: "3",
    workspace_revision: "1",
    state: 1,
    expires_at_ms: message.expires_at_ms,
    approved_device: device,
    approved_grant: id(15),
    grant_version: "1",
    human_generation: "1",
    encrypted_record: id(26),
  };
  const binding = {
    permission_id: id(4),
    permission_version: "1",
    approval_id: approved ? id(9) : null,
  };
  const capability = {
    schema_version: 1,
    org_id: id(2),
    issuer: id(3),
    delegate: device,
    parent_id: null,
    parent_revocation_version: "0",
    reservation_scope: 2,
    target_kind: 3,
    node_id: id(11),
    agent_id: managed.instance_id,
    actions: ["direct.message"],
    scope: "direct",
    max_uses: "10000",
    uses_claimed: "0",
    uses_delegated: "0",
    budget_asset: "TOOL_CALLS",
    max_budget: "6",
    budget_claimed: "0",
    budget_delegated: "0",
    expires_at_ms: String(now + 120000),
    revocation_version: "1",
    revoked: false,
  };
  let messageOwner = "Immutable",
    permissionOwner = "Shared",
    objectReads = 0,
    indexSize = 1,
    changedAfterList = false;
  const core = {
    getObject: async ({ objectId }: { objectId: string }) => {
      objectReads++;
      const shared = (
        name: string,
        content: Uint8Array,
        module = "direct_agent",
        owner = "Shared",
      ) => ({
        object: {
          objectId,
          type: `${id(1)}::${module}::${name}`,
          owner: { $kind: owner },
          content,
        },
      });
      if (objectId === id(4))
        return shared(
          "StandingPermission",
          StandingPermissionBcs.serialize({
            ...permission,
            messages: {
              ...permission.messages,
              size: String(changedAfterList ? indexSize + 1 : indexSize),
            },
          }).toBytes(),
          "direct_agent",
          permissionOwner,
        );
      if (objectId === id(8))
        return shared(
          "Message",
          DirectMessageBcs.serialize(message).toBytes(),
          "direct_agent",
          messageOwner,
        );
      if (objectId === id(5))
        return shared(
          "ManagedAgent",
          ManagedAgentBcs.serialize(managed).toBytes(),
          "host",
        );
      if (objectId === id(6))
        return shared(
          "HostMembership",
          HostMembershipBcs.serialize(member).toBytes(),
          "host",
        );
      if (objectId === id(9))
        return shared(
          "Approval",
          DirectApprovalBcs.serialize(approval).toBytes(),
        );
      if (objectId === id(10))
        return {
          object: {
            objectId,
            type: `${id(1)}::remote_authority::RemoteCapability`,
            owner: { $kind: "Shared" },
            json: capability,
          },
        };
      throw new Error("Unexpected fixture object");
    },
    getDynamicField: async ({
      parentId,
      name,
    }: {
      parentId: string;
      name: { type: string; bcs: Uint8Array };
    }) => {
      if (parentId === id(10)) {
        assert.equal(
          name.type,
          `${id(1)}::direct_agent::PermissionCapabilityKey`,
        );
        return {
          dynamicField: {
            value: {
              type: `${id(1)}::direct_agent::PermissionCapability`,
              bcs: PermissionBinding.serialize(binding).toBytes(),
            },
          },
        };
      }
      if (parentId === id(21))
        return {
          dynamicField: {
            value: {
              type: "0x2::object::ID",
              bcs: bcs.Address.serialize(id(8)).toBytes(),
            },
          },
        };
      throw new Error("Unexpected fixture index");
    },
    listDynamicFields: async () => ({
      dynamicFields: [
        {
          name: {
            type: "0x1::string::String",
            bcs: bcs.string().serialize("msg-1").toBytes(),
          },
        },
      ],
      hasNextPage: false,
      cursor: null,
    }),
  };
  const sdk = new FractalMindSDK({
    packageId: id(1),
    client: { core } as unknown as ClientWithCoreApi,
  });
  const authority = {
    humanId: id(3),
    grantId: id(7),
    membershipId: id(6),
    bindingId: id(12),
    managedAgentId: id(5),
  };
  const context = {
    version: "1" as const,
    permission_id: id(4),
    permission_version: "1",
    message_id: id(8),
    conversation_id: "conv-1",
    message_token: "msg-1",
    message_record_id: id(25),
    action: "file.write" as const,
    ...(approved ? { approval_id: id(9), approving_grant_id: id(15) } : {}),
  };
  const command = (
    payload: Record<string, unknown> = { ...request, direct: context },
    target = {
      organizationId: id(2),
      nodeId: id(11),
      agentId: managed.instance_id,
    },
  ) =>
    signNodeCommand(signer, {
      target,
      action: "direct.message",
      scope: "direct",
      capability: { id: id(10), revocationVersion: 1n },
      commandId: "direct-cmd",
      nonce: "direct-nonce",
      idempotencyKey: "direct-idem",
      budget: { asset: "TOOL_CALLS", amount: 3n },
      issuedAtMs: now,
      expiresAtMs: now + 60000,
      payload,
    });
  return {
    sdk,
    core,
    authority,
    context,
    command,
    permission,
    message,
    managed,
    member,
    approval,
    binding,
    capability,
    mutableOwner: (value: string) => {
      messageOwner = value;
    },
    forgedPermissionOwner: (value: string) => {
      permissionOwner = value;
    },
    reads: () => objectReads,
    changeAfterListing: () => {
      const list = core.listDynamicFields;
      core.listDynamicFields = async () => {
        const value = await list();
        changedAfterList = true;
        return value;
      };
    },
  };
}

test("direct request content hash fixes body, action, tool budget and semantic path sets", () => {
  const hash = directRequestHash(request, "file.write");
  assert.deepEqual(
    hash,
    directRequestHash(
      {
        ...request,
        bounds: {
          max_calls: "3",
          paths: { "file.read": ["docs"], "file.write": ["docs"] },
        },
      },
      "file.write",
    ),
  );
  assert.notDeepEqual(
    hash,
    directRequestHash(
      { ...request, message: "another instruction" },
      "file.write",
    ),
  );
  assert.notDeepEqual(
    hash,
    directRequestHash({ ...request, task: "another task" }, "file.write"),
  );
  assert.notDeepEqual(
    hash,
    directRequestHash(
      { ...request, bounds: { ...request.bounds, max_calls: "4" } },
      "file.write",
    ),
  );
  assert.throws(
    () =>
      directRequestHash(
        { ...request, bounds: { ...request.bounds, max_calls: "03" } },
        "file.write",
      ),
    /u64/,
  );
  assert.throws(
    () => directRequestHash({ ...request, message: "\ud800" }, "file.write"),
    /body/,
  );
  assert.throws(() => directRequestHash(request, "status"), /budget/);
});

test("normal and approved signed messages prepare through the direct contract with original identities", async () => {
  for (const approved of [false, true]) {
    const f = fixture(approved),
      command = await f.command(),
      tx = await f.sdk.nodeExecution.prepareCommand({
        ...f.authority,
        command,
      });
    const calls = tx
      .getData()
      .commands.filter((x) => x.$kind === "MoveCall")
      .map((x) => x.MoveCall);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].module, "direct_agent");
    assert.equal(
      calls[0].function,
      approved ? "prepare_approved_message" : "prepare_message",
    );
    assert.equal(calls[0].arguments.length, approved ? 18 : 16);
    const objectIds = tx
      .getData()
      .inputs.filter((x) => x.$kind === "UnresolvedObject")
      .map((x) => x.UnresolvedObject.objectId);
    assert.equal(objectIds[0], id(4));
    assert.equal(objectIds[1], approved ? id(9) : id(8));
    assert.equal(objectIds.includes(id(15)), approved);
  }
});

test("even correctly re-signed messages cannot replace immutable source content, instance or budget", async () => {
  const variations: Array<
    (
      f: ReturnType<typeof fixture>,
    ) => Promise<Awaited<ReturnType<ReturnType<typeof fixture>["command"]>>>
  > = [
    (f) =>
      f.command({
        ...request,
        message: "different persisted instruction",
        direct: f.context,
      }),
    (f) =>
      f.command({
        ...request,
        direct: { ...f.context, message_record_id: id(27) },
      }),
    (f) =>
      f.command({
        ...request,
        direct: { ...f.context, permission_version: "2" },
      }),
    (f) =>
      f.command(
        { ...request, direct: f.context },
        {
          organizationId: id(2),
          nodeId: id(28),
          agentId: f.managed.instance_id,
        },
      ),
    (f) =>
      f.command(
        { ...request, direct: f.context },
        {
          organizationId: id(2),
          nodeId: id(11),
          agentId: "same-name-on-another-instance",
        },
      ),
    (f) =>
      f.command({
        ...request,
        bounds: { ...request.bounds, max_calls: "4" },
        direct: f.context,
      }),
    (f) => f.command({ ...request, extra_tools: true, direct: f.context }),
    (f) => f.command({ ...request, okr: { id: id(30) }, direct: f.context }),
  ];
  for (const change of variations) {
    const f = fixture(),
      tx = new Transaction();
    await assert.rejects(
      f.sdk.nodeExecution.prepareCommand({
        ...f.authority,
        command: await change(f),
        tx,
      }),
      /context|bounds|fixed instance/,
    );
    assert.equal(tx.getData().commands.length, 0);
  }
});

test("revoked or replaced Host, managed instance, policy and capability are rejected before transaction mutation", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.permission.revoked = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.permission.version = "2";
    },
    (f: ReturnType<typeof fixture>) => {
      f.permission.reserved = "7";
    },
    (f: ReturnType<typeof fixture>) => {
      f.managed.control_confirmed = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.managed.workspace_hash[0] = 9;
    },
    (f: ReturnType<typeof fixture>) => {
      f.member.revoked = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.member.version = "2";
    },
    (f: ReturnType<typeof fixture>) => {
      f.capability.revoked = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.capability.delegate = id(30);
    },
    (f: ReturnType<typeof fixture>) => {
      f.binding.permission_version = "2";
    },
    (f: ReturnType<typeof fixture>) => {
      f.mutableOwner("Shared");
    },
    (f: ReturnType<typeof fixture>) => {
      f.forgedPermissionOwner("Immutable");
    },
  ]) {
    const f = fixture(),
      command = await f.command(),
      tx = new Transaction();
    mutate(f);
    await assert.rejects(
      f.sdk.nodeExecution.prepareCommand({ ...f.authority, command, tx }),
      /context|permission state|direct object source/,
    );
    assert.equal(tx.getData().commands.length, 0);
  }
});

test("one-off approval must match the original message and approver, with both approved and consumed states readable", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.approval.state = 0;
    },
    (f: ReturnType<typeof fixture>) => {
      f.approval.state = 2;
    },
    (f: ReturnType<typeof fixture>) => {
      f.approval.message_id = id(31);
    },
    (f: ReturnType<typeof fixture>) => {
      f.approval.approved_grant = id(32);
    },
    (f: ReturnType<typeof fixture>) => {
      f.approval.boundary_hash = new Array(32).fill(0);
    },
    (f: ReturnType<typeof fixture>) => {
      f.binding.approval_id = null;
    },
  ]) {
    const f = fixture(true),
      command = await f.command();
    mutate(f);
    await assert.rejects(
      f.sdk.nodeExecution.prepareCommand({ ...f.authority, command }),
      /approval|context/,
    );
  }
  const f = fixture(true);
  f.approval.state = 3;
  assert.equal(
    (
      await f.sdk.nodeExecution.prepareCommand({
        ...f.authority,
        command: await f.command(),
      })
    ).getData().commands.length,
    1,
  );
});

test("signature mutation and absent direct context reject before any chain read", async () => {
  const f = fixture(),
    command = await f.command();
  await assert.rejects(
    f.sdk.nodeExecution.prepareCommand({
      ...f.authority,
      command: {
        ...command,
        payload: { ...command.payload, message: "unsigned replacement" },
      },
    }),
    /payload/,
  );
  await assert.rejects(
    f.sdk.nodeExecution.prepareCommand({
      ...f.authority,
      command: await f.command({ ...request }),
    }),
    /signed standing/,
  );
  assert.equal(f.reads(), 0);
});

test("message history reads immutable Sui records and rejects a changing directory", async () => {
  const f = fixture();
  assert.equal((await f.sdk.directAgent.listMessages(id(4)))[0].id, id(8));
  f.changeAfterListing();
  await assert.rejects(f.sdk.directAgent.listMessages(id(4)), /changed/);
  const g = fixture();
  g.mutableOwner("Shared");
  await assert.rejects(g.sdk.directAgent.listMessages(id(4)), /source/);
});

test("direct lifecycle builders retain unknown reservations and pin single approvals without signing or delivery", () => {
  const f = fixture(),
    api = f.sdk.directAgent;
  assert.throws(
    () =>
      api.finishMessage({
        permissionId: id(4),
        executionId: id(33),
        capabilityId: id(10),
        organizationId: id(2),
        finalState: 4,
        expectedCursor: 2n,
        spentAmount: 1n,
        keyVersion: 1n,
        encryptedResult: body,
      }),
    /retain/,
  );
  assert.throws(
    () =>
      api.beginMessage({
        ...f.authority,
        organizationId: id(2),
        permissionId: id(4),
        messageId: id(8),
        executionId: id(33),
        capabilityId: id(10),
        approvalId: id(9),
      }),
    /together/,
  );
  assert.throws(
    () => parseDirectMessageContext({ ...f.context, approval_id: id(9) }),
    /ID/,
  );
  assert.throws(
    () =>
      parseDirectMessageContext({
        ...f.context,
        permission_version: "18446744073709551616",
      }),
    /u64/,
  );
  assert.throws(
    () =>
      api.createPermission({
        ...f.authority,
        organizationId: id(2),
        actions: ["file.write", "file.write"],
        paths,
        maxCalls: 3n,
        budgetLimit: 6n,
        expiresAtMs: now + 1000,
        keyVersion: 1n,
        encryptedBody: body,
      }),
    /permission/,
  );
  assert.throws(
    () =>
      api.createMessage({
        ...f.authority,
        organizationId: id(2),
        permissionId: id(4),
        expectedVersion: 1n,
        conversationId: "conv",
        messageToken: "msg",
        action: "status",
        paths,
        budgetAmount: 1n,
        requestHash: new Uint8Array(32),
        expiresAtMs: now + 1000,
        keyVersion: 1n,
        encryptedBody: body,
      }),
    /budget/,
  );
});
