import test from "node:test";
import assert from "node:assert/strict";
import type { DirectMessageView, NativeDirectAgent } from "../src/direct-agent";
import { directConversationState } from "../src/direct-conversation-state";

function fixture() {
  const description = {
    managed: {
      id: "agent",
      version: "2",
      membership_id: "member",
      host_address: "host",
      workspace_hash: [1],
      revoked: false,
      control_confirmed: true,
      runtime: "bounded-process-v1",
      instance_id: `native-${"a".repeat(64)}`,
    },
    member: {
      id: "member",
      version: "3",
      host_address: "host",
      revoked: false,
      expires_at_ms: "4000",
    },
    binding: { revoked: false },
    humanGeneration: "1",
    authorityExpiresAtMs: "4000",
    permission: {
      id: "permission",
      managed_agent: "agent",
      managed_version: "2",
      membership_id: "member",
      membership_version: "3",
      host_address: "host",
      workspace_hash: [1],
      human_generation: "1",
      version: "4",
      expires_at_ms: "3000",
      revoked: false,
    },
  } as Awaited<ReturnType<NativeDirectAgent["describe"]>>;
  const selected = {
    message: {
      id: "message",
      permission_id: "permission",
      permission_version: "4",
      managed_agent: "agent",
      managed_version: "2",
      membership_id: "member",
      human_generation: "1",
      expires_at_ms: "2500",
      action: "file.write",
    },
    approval: {
      message_id: "message",
      permission_id: "permission",
      permission_version: "4",
      managed_version: "2",
      human_generation: "1",
      expires_at_ms: "2400",
      workspace_revision: "5",
    },
    workspace: { complete: true, revision: "5" },
  } as DirectMessageView;
  return { description, selected };
}

test("conversation mutation entries use fresh managed/member and permission versions", () => {
  const f = fixture();
  assert.deepEqual(directConversationState(f.description, f.selected, 2000n), {
    current: true,
    fresh: true,
    approvalFresh: true,
    approvalWorkspaceFresh: true,
  });
  f.description.managed.version = "3";
  assert.equal(
    directConversationState(f.description, f.selected, 2000n).current,
    false,
  );
  assert.equal(
    directConversationState(f.description, f.selected, 2000n).fresh,
    false,
  );
  f.description.managed.version = "2";
  f.description.member.version = "4";
  assert.equal(
    directConversationState(f.description, f.selected, 2000n).current,
    false,
  );
});

test("revoked binding, old Human generation and changed workspace hide execution entries", () => {
  for (const update of [
    (d: ReturnType<typeof fixture>["description"]) => {
      d.binding.revoked = true;
    },
    (d: ReturnType<typeof fixture>["description"]) => {
      d.humanGeneration = "2";
    },
    (d: ReturnType<typeof fixture>["description"]) => {
      d.managed.workspace_hash = [2];
    },
  ]) {
    const f = fixture();
    update(f.description);
    assert.equal(
      directConversationState(f.description, f.selected, 2000n).fresh,
      false,
    );
  }
});

test("expired historical message cannot prepare a new action but retains current permission distinction", () => {
  const f = fixture();
  const state = directConversationState(f.description, f.selected, 2500n);
  assert.equal(state.current, true);
  assert.equal(state.fresh, false);
  assert.equal(state.approvalFresh, false);
  assert.equal(directConversationState(null, f.selected, 2000n).current, false);
});

test("workspace revision changes block approving/executing writes while retaining explicit rejection", () => {
  const f = fixture();
  f.selected.workspace.revision = "6";
  const state = directConversationState(f.description, f.selected, 2000n);
  assert.equal(state.fresh, true);
  assert.equal(state.approvalFresh, true);
  assert.equal(state.approvalWorkspaceFresh, false);
  f.selected.message.action = "status";
  assert.equal(
    directConversationState(f.description, f.selected, 2000n)
      .approvalWorkspaceFresh,
    true,
  );
});
