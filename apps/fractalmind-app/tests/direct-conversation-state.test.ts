import test from "node:test";
import assert from "node:assert/strict";
import type { DirectMessageView, NativeDirectAgent } from "../src/direct-agent";
import {
  canComposeAfterPermissionReceipt,
  canComposeAfterSettledRun,
  canComposeAfterSupersededDecision,
  canComposeAfterResolvedOriginal,
  directConversationState,
  directMessageRemainingSeconds,
} from "../src/direct-conversation-state";
import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";

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

test("the shared deadline countdown reaches zero without extending expired history", () => {
  const originalExpiry = "301000";
  assert.equal(directMessageRemainingSeconds(originalExpiry, 1000), 300);
  assert.equal(directMessageRemainingSeconds(originalExpiry, 300999), 1);
  assert.equal(directMessageRemainingSeconds(originalExpiry, 301000), 0);
  assert.equal(directMessageRemainingSeconds(originalExpiry, 999000), 0);
  assert.equal(originalExpiry, "301000");
});

test("a pruned permission receipt permits a distinct message only under newer verified authority", () => {
  const { description } = fixture();
  const receipt: SelfPayTransactionOutcome = {
    status: "unknown",
    requestId: "direct-permission:agent:create",
    digest: "original-permission-digest",
    journalSynced: true,
  };
  assert.equal(
    canComposeAfterPermissionReceipt(description, receipt, 2000n),
    true,
  );
  assert.equal(receipt.status, "unknown");
  receipt.requestId = "direct-permission:agent:3";
  assert.equal(
    canComposeAfterPermissionReceipt(description, receipt, 2000n),
    true,
  );
  receipt.requestId = "direct-permission:agent:4";
  assert.equal(
    canComposeAfterPermissionReceipt(description, receipt, 2000n),
    false,
  );
  receipt.requestId = "direct-permission:agent:create";
  description.permission!.revoked = true;
  assert.equal(
    canComposeAfterPermissionReceipt(description, receipt, 2000n),
    false,
  );
});

test("unknown message, execution, approval and foreign permission remain blocked", () => {
  const { description } = fixture();
  for (const requestId of [
    "direct-message:message-token",
    "direct-run:message",
    "direct-decision:message:true",
    "direct-capability:message",
    "direct-permission:another-agent:create",
    "direct-permission:agent:create:extra",
    "direct-permission:agent:-1",
  ]) {
    assert.equal(
      canComposeAfterPermissionReceipt(
        description,
        {
          status: "unknown",
          requestId,
          digest: "original",
          journalSynced: true,
        },
        2000n,
      ),
      false,
      requestId,
    );
  }
  assert.equal(
    canComposeAfterPermissionReceipt(
      description,
      {
        status: "unknown",
        requestId: "direct-permission:agent:create",
        digest: "original",
        journalSynced: true,
      },
      4000n,
    ),
    false,
  );
  assert.equal(canComposeAfterPermissionReceipt(null, null, 2000n), false);
});

function settledRunFixture() {
  const { description, selected } = fixture();
  Object.assign(selected.message, {
    org_id: "organization",
    writer_device: "device",
    grant_id: "grant",
    budget_amount: "0",
    action: "status",
  });
  selected.result = {
    run: {
      id: "run",
      state: 2,
      result_record: "original-result",
      result_hash: new Array(32).fill(1),
      managed_agent: "agent",
      org_id: "organization",
      membership_id: "member",
      host_address: "host",
      agent_id: description.managed.instance_id,
      action: "direct.message",
      scope: "direct",
      delegate: "device",
      grant_id: "grant",
      budget_amount: "0",
      capability_id: "capability",
      command_id: "original-command",
    } as NonNullable<DirectMessageView["result"]>["run"],
    recordId: "original-result",
    transactionDigest: "result-object-provenance",
    response: {
      execution_id: "run",
      execution_state: "succeeded",
      command_id: "original-command",
      ok: true,
      requires_confirmation: false,
    },
  };
  selected.claim = {
    capability_id: "capability",
    message_id: "message",
    permission_version: "4",
    approval_id: null,
    reserved: "0",
    spent: "0",
    settled: true,
  };
  const receipt: SelfPayTransactionOutcome = {
    status: "unknown",
    requestId: "direct-run:message",
    digest: "pruned-original-transaction",
    journalSynced: true,
  };
  return { description, selected, receipt };
}

test("a verified original success and settled claim allow a distinct message without changing an unknown receipt", () => {
  const f = settledRunFixture(),
    originalReceipt = structuredClone(f.receipt);
  assert.equal(
    canComposeAfterSettledRun(f.description, f.selected, f.receipt, 2000n),
    true,
  );
  assert.deepEqual(f.receipt, originalReceipt);
  // The independent permission path cannot authorize this Run request.
  assert.equal(
    canComposeAfterPermissionReceipt(f.description, f.receipt, 2000n),
    false,
  );
});

test("a linked Run or unverified/unfinished result never releases the composer", () => {
  const cases: Array<
    [string, (f: ReturnType<typeof settledRunFixture>) => void]
  > = [
    [
      "Run pointer only",
      (f) => {
        f.selected.result!.response = null;
        f.selected.result!.recordId = null;
      },
    ],
    [
      "ciphertext was not decrypted",
      (f) => {
        f.selected.result!.response = null;
      },
    ],
    [
      "missing original result record",
      (f) => {
        f.selected.result!.recordId = null;
      },
    ],
    [
      "different original result record",
      (f) => {
        f.selected.result!.recordId = "another-result";
      },
    ],
    [
      "missing original body hash",
      (f) => {
        f.selected.result!.run.result_hash = [];
      },
    ],
    [
      "claim missing",
      (f) => {
        f.selected.claim = null;
      },
    ],
    [
      "claim unsettled",
      (f) => {
        f.selected.claim!.settled = false;
      },
    ],
    [
      "result requests confirmation",
      (f) => {
        f.selected.result!.response!.requires_confirmation = true;
      },
    ],
    [
      "result reports failure",
      (f) => {
        f.selected.result!.response!.ok = false;
      },
    ],
    ...[0, 1, 3, 4, 5].map(
      (state) =>
        [
          `Run state ${state}`,
          (f: ReturnType<typeof settledRunFixture>) => {
            f.selected.result!.run.state = state;
          },
        ] as [string, (f: ReturnType<typeof settledRunFixture>) => void],
    ),
  ];
  for (const [name, update] of cases) {
    const f = settledRunFixture();
    update(f);
    assert.equal(
      canComposeAfterSettledRun(f.description, f.selected, f.receipt, 2000n),
      false,
      name,
    );
  }
});

test("an expired completed message permits only a distinct new message under live authority", () => {
  const f = settledRunFixture();
  f.selected.message.expires_at_ms = "1999";
  assert.equal(
    canComposeAfterSettledRun(f.description, f.selected, f.receipt, 2000n),
    true,
  );
  assert.equal(
    directConversationState(f.description, f.selected, 2000n).fresh,
    false,
  );
  f.description.permission!.expires_at_ms = "1999";
  assert.equal(
    canComposeAfterSettledRun(f.description, f.selected, f.receipt, 2000n),
    false,
  );
  f.description.permission!.expires_at_ms = "3000";
  f.description.member.expires_at_ms = "1999";
  assert.equal(
    canComposeAfterSettledRun(f.description, f.selected, f.receipt, 2000n),
    false,
  );
});

test("a successful but foreign message, Run or claim and stale current permission cannot release an unknown request", () => {
  const cases: Array<
    [string, (f: ReturnType<typeof settledRunFixture>) => void]
  > = [
    [
      "another selected message",
      (f) => {
        f.receipt.requestId = "direct-run:other-message";
      },
    ],
    [
      "unknown message save",
      (f) => {
        f.receipt.requestId = "direct-message:token";
      },
    ],
    [
      "unknown approval",
      (f) => {
        f.receipt.requestId = "direct-decision:message:true";
      },
    ],
    [
      "unknown capability",
      (f) => {
        f.receipt.requestId = "direct-capability:message";
      },
    ],
    [
      "wrong Run",
      (f) => {
        f.selected.result!.run.id = "other-run";
      },
    ],
    [
      "wrong managed instance",
      (f) => {
        f.selected.result!.run.managed_agent = "other-agent";
      },
    ],
    [
      "wrong claim message",
      (f) => {
        f.selected.claim!.message_id = "other-message";
      },
    ],
    [
      "wrong claim capability",
      (f) => {
        f.selected.claim!.capability_id = "other-capability";
      },
    ],
    [
      "wrong claim revision",
      (f) => {
        f.selected.claim!.permission_version = "3";
      },
    ],
    [
      "wrong claim budget",
      (f) => {
        f.selected.claim!.reserved = "1";
      },
    ],
    [
      "wrong receipt body",
      (f) => {
        f.selected.result!.response!.execution_id = "other-run";
      },
    ],
    [
      "permission revoked",
      (f) => {
        f.description.permission!.revoked = true;
      },
    ],
    [
      "permission expired",
      (f) => {
        f.description.permission!.expires_at_ms = "1999";
      },
    ],
    [
      "permission replaced",
      (f) => {
        f.description.permission!.version = "5";
      },
    ],
    [
      "managed version advanced",
      (f) => {
        f.description.managed.version = "3";
      },
    ],
    [
      "device authority expired",
      (f) => {
        f.description.authorityExpiresAtMs = "1999";
      },
    ],
  ];
  for (const [name, update] of cases) {
    const f = settledRunFixture();
    update(f);
    assert.equal(
      canComposeAfterSettledRun(f.description, f.selected, f.receipt, 2000n),
      false,
      name,
    );
  }
  const f = settledRunFixture();
  assert.equal(
    canComposeAfterSettledRun(null, f.selected, f.receipt, 2000n),
    false,
  );
  assert.equal(
    canComposeAfterSettledRun(f.description, null, f.receipt, 2000n),
    false,
  );
  assert.equal(
    canComposeAfterSettledRun(f.description, f.selected, null, 2000n),
    false,
  );
});

function supersededDecisionFixture() {
  const f = settledRunFixture();
  f.description.permission!.org_id = "organization";
  f.description.permission!.version = "5";
  f.selected.message.boundary_hash = new Array(32).fill(1);
  f.selected.message.expires_at_ms = "1000";
  f.selected.result = null;
  f.selected.claim = null;
  f.selected.readPermission = {
    id: f.description.permission!.id,
    version: "5",
  };
  Object.assign(f.selected.approval!, {
    id: "original-approval",
    org_id: "organization",
    managed_agent: "agent",
    human_generation: "1",
    action: "status",
    budget_amount: "0",
    boundary_hash: new Array(32).fill(1),
    state: 1,
  });
  f.receipt.requestId = "direct-decision:message:true";
  return f;
}

test("a renewed permission supersedes an exact expired old decision with no Run without resolving its receipt", () => {
  const f = supersededDecisionFixture(),
    original = structuredClone(f.receipt);
  assert.equal(
    canComposeAfterSupersededDecision(
      f.description,
      f.selected,
      f.receipt,
      2000n,
    ),
    true,
  );
  assert.equal(
    canComposeAfterResolvedOriginal(
      f.description,
      f.selected,
      f.receipt,
      2000n,
    ),
    true,
  );
  assert.equal(
    directConversationState(f.description, f.selected, 2000n).approvalFresh,
    false,
  );
  assert.deepEqual(f.receipt, original);
});

test("superseding a decision never substitutes another permission/message or ignores an original Run or expired authority", () => {
  const cases: Array<
    [string, (f: ReturnType<typeof supersededDecisionFixture>) => void]
  > = [
    [
      "different request",
      (f) => {
        f.receipt.requestId = "direct-decision:other-message:true";
      },
    ],
    [
      "unknown Run",
      (f) => {
        f.receipt.requestId = "direct-run:message";
      },
    ],
    [
      "unknown message creation",
      (f) => {
        f.receipt.requestId = "direct-message:token";
      },
    ],
    [
      "permission did not advance",
      (f) => {
        f.description.permission!.version = "4";
      },
    ],
    [
      "pre-renewal cached no Run",
      (f) => {
        f.selected.readPermission.version = "4";
      },
    ],
    [
      "unknown no-Run read source",
      (f) => {
        f.selected.readPermission = undefined as any;
      },
    ],
    [
      "different permission",
      (f) => {
        f.description.permission!.id = "other-permission";
      },
    ],
    [
      "different approval message",
      (f) => {
        f.selected.approval!.message_id = "other-message";
      },
    ],
    [
      "different approval version",
      (f) => {
        f.selected.approval!.permission_version = "3";
      },
    ],
    [
      "different approval boundary",
      (f) => {
        f.selected.approval!.boundary_hash = new Array(32).fill(2);
      },
    ],
    [
      "consumed approval",
      (f) => {
        f.selected.approval!.state = 3;
      },
    ],
    [
      "existing original Run",
      (f) => {
        f.selected.result = settledRunFixture().selected.result;
      },
    ],
    [
      "unreadable Run coverage",
      (f) => {
        f.selected.result = undefined as any;
      },
    ],
    [
      "existing claim",
      (f) => {
        f.selected.claim = settledRunFixture().selected.claim;
      },
    ],
    [
      "missing approval",
      (f) => {
        f.selected.approval = null;
      },
    ],
    [
      "permission expired",
      (f) => {
        f.description.permission!.expires_at_ms = "1999";
      },
    ],
    [
      "permission revoked",
      (f) => {
        f.description.permission!.revoked = true;
      },
    ],
    [
      "member expired",
      (f) => {
        f.description.member.expires_at_ms = "1999";
      },
    ],
    [
      "device authority expired",
      (f) => {
        f.description.authorityExpiresAtMs = "1999";
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    const f = supersededDecisionFixture();
    mutate(f);
    assert.equal(
      canComposeAfterSupersededDecision(
        f.description,
        f.selected,
        f.receipt,
        2000n,
      ),
      false,
      name,
    );
  }
});

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
