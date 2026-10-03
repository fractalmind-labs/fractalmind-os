import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  fromBase64,
  toBase64,
  normalizeSuiAddress as id,
} from "@mysten/sui/utils";
import {
  FractalMindSDK,
  MemoryTransactionJournal,
  executionBoundaryHash,
  signNodeCommand,
  nodeCommandIntentHash,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  NativeDirectAgent,
  DirectAgentError,
  standingInput,
  directApprovalReasons,
  boundedDirectRequest,
  modelReply,
  type DirectOperation,
} from "../src/direct-agent";
import { NativeDeviceSigner } from "../src/native-device";
import type { ChainReadSession } from "../src/chain";
const org = id("1"),
  human = id("2"),
  grant = id("3"),
  managed = id("4"),
  host = id("5"),
  member = id("6"),
  binding = id("7"),
  permission = id("8"),
  messageId = id("9"),
  runId = id("a"),
  capability = id("b");
const paths = { "file.read": ["docs"], "file.write": ["docs"] };
const policy = () => ({
  actions: ["status", "file.read", "file.write"] as const,
  paths,
  maxCalls: "3",
  budgetLimit: "6",
  expiresAtMs: String(Date.now() + 3600000),
});
test("model reply display rejects self-verified claims and missing token usage", () => {
  const reply = {
    schema: "fractalmind.model-reply.v1",
    status: "answered",
    verified: false,
    reply: {
      text: "<script>untrusted prose</script>",
      model: "fixture",
      usage: { input_tokens: 3, output_tokens: 2 },
    },
  };
  assert.equal(modelReply(reply)?.text, reply.reply.text);
  assert.equal(modelReply({ ...reply, verified: true }), null);
  assert.equal(
    modelReply({ ...reply, reply: { ...reply.reply, usage: {} } }),
    null,
  );
  assert.equal(
    modelReply({
      ...reply,
      reply: { ...reply.reply, usage: { input_tokens: -1, output_tokens: 2 } },
    }),
    null,
  );
  assert.equal(modelReply(null), null);
});
test("model questions carry exact text, zero tools and no task; standing ask does not grant file access", () => {
  const p = standingInput({
    actions: ["status", "ask"],
    paths: { "file.read": ["docs"] },
    maxCalls: "0",
    budgetLimit: "0",
    expiresAtMs: String(Date.now() + 60000),
  });
  const request = boundedDirectRequest({
    action: "ask",
    message: "Explain the current proposal",
    paths: p.paths,
    maxCalls: "999",
    path: "../secret",
    content: "unapproved",
  });
  assert.equal(request.bounds.max_calls, "0");
  assert.equal(request.task, undefined);
  assert.equal(request.message, "Explain the current proposal");
  assert.deepEqual(p.actions, ["status", "ask"]);
  const permission = {
    allowed_actions: p.actions,
    max_calls: "0",
    budget_limit: "0",
    spent: "0",
    reserved: "0",
    boundary_hash: Array.from(executionBoundaryHash(p.paths)),
  };
  assert.deepEqual(
    directApprovalReasons(permission, "ask", request, {
      protected: true,
      complete: true,
    }),
    [],
  );
  assert.deepEqual(
    directApprovalReasons(
      { ...permission, allowed_actions: ["status"] },
      "ask",
      request,
      { protected: true, complete: true },
    ),
    ["action"],
  );
});
test("bounded file requests can seek exact approval outside standing actions and directories without widening authority", () => {
  const standing = {
    allowed_actions: ["status"],
    max_calls: "0",
    budget_limit: "0",
    spent: "0",
    reserved: "0",
    boundary_hash: Array.from(executionBoundaryHash({ "file.read": ["docs"] })),
  };
  const request = boundedDirectRequest({
    action: "file.write",
    message: "Generate one release note",
    paths: { "file.read": ["docs"], "file.write": ["release"] },
    maxCalls: "3",
    path: "release/NOTES.md",
    content: "Approved release note",
  });
  assert.deepEqual(
    directApprovalReasons(standing, "file.write", request, {
      protected: false,
      complete: true,
    }),
    ["action", "boundary", "per_message_limit", "budget"],
  );
  assert.deepEqual(standing.allowed_actions, ["status"]);
  assert.equal(standing.budget_limit, "0");
  assert.deepEqual(JSON.parse(request.task!), {
    kind: "ensure_text_files",
    files: [{ path: "release/NOTES.md", content: "Approved release note" }],
  });
  for (const path of [
    "/release/x",
    "release/../secret",
    "release\\secret",
    "release/:secret",
    "elsewhere/secret",
    "release/\u0000secret",
  ])
    assert.throws(
      () =>
        boundedDirectRequest({
          action: "file.write",
          message: "Write",
          paths: { "file.write": ["release"] },
          maxCalls: "3",
          path,
        }),
      DirectAgentError,
    );
});
// Controlled fee/source fixture. Production SDK builders and native signature
// wrappers are real; full source reconstruction and OS crypto are exercised by
// the separate native/localnet harness, not inferred from this fixture.
async function fixture() {
  const key = Ed25519Keypair.generate();
  let live = true,
    pin = "original",
    nativeCalls = 0,
    builds = 0,
    broadcasts = 0,
    deliveries = 0,
    signs = 0,
    duringNative = () => {},
    duringQuote = () => {},
    duringChallenge = () => {};
  const assertLive = () => {
    if (!live) throw new DirectAgentError("state_changed");
  };
  const invoke = async (command: string, args: Record<string, string>) => {
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: args.profile,
        address: key.toSuiAddress(),
        signingPublicKey: key.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(new Uint8Array(32)),
      };
    nativeCalls++;
    duringNative();
    if (command === "fm_device_sign_transaction") {
      signs++;
      return key.signTransaction(fromBase64(args.bytes));
    }
    if (command === "fm_device_sign_node_command")
      return {
        bytes: args.bytes,
        signature: toBase64(await key.sign(fromBase64(args.bytes))),
      };
    assert.equal(command, "fm_device_encrypt_record");
    const record = JSON.parse(args.record);
    assert.equal(record.organizationId, org);
    const body = new Uint8Array(40);
    body.set(new TextEncoder().encode("FME1"));
    return toBase64(body);
  };
  const signer = await NativeDeviceSigner.load(invoke, "direct-test");
  const sdk = new FractalMindSDK({
    packageId: id("c"),
    directPackageId: id("d"),
    client: { core: {} } as any,
  });
  const chain = {
    profile: { network: "localnet", humanId: human },
    checkNetwork: async () => "fixture",
    sdk,
  } as unknown as ChainReadSession;
  const controller = new NativeDirectAgent(
    chain,
    signer,
    grant,
    org,
    managed,
    invoke,
    new MemoryTransactionJournal(),
    fetch,
    assertLive,
  );
  const source = {
    authority: {
      authorityPin: "authority",
      humanId: human,
      generation: "1",
      grantVersion: "1",
      encryptedKeys: { fixture: true },
      clockMs: BigInt(Date.now()),
      expiresAtMs: String(Date.now() + 7200000),
      actions: ["read", "operate", "approve"],
    },
    managed: {
      id: managed,
      version: "1",
      host_address: host,
      instance_id: "native-" + "aa".repeat(32),
      workspace_hash: Array(32).fill(1),
    },
    member: {
      id: member,
      version: "1",
      expires_at_ms: String(Date.now() + 7200000),
    },
    binding: { id: binding },
    permission: null as any,
    keyVersion: "1",
    workspace: { protected: false, revision: "1", complete: true },
  };
  let sourceReads = 0;
  const prior = new Map<string, SelfPayTransactionOutcome>(),
    queried: string[] = [],
    sourceActions: string[] = [];
  (controller as any).source = async (action = "read") => {
    sourceReads++;
    sourceActions.push(action);
    assertLive();
    return structuredClone({ ...source, pin });
  };
  const sign = (controller as any).manager.options.signer.signTransaction;
  (controller as any).manager = {
    query: async (requestId: string) => {
      queried.push(requestId);
      return prior.get(requestId);
    },
    prepare: async (input: any) => {
      builds++;
      duringQuote();
      return Object.freeze({
        requestId: input.requestId,
        expiresAtMs: Date.now() + 60000,
      });
    },
    submit: async (quote: any) => {
      await sign(new Uint8Array([1, 2, 3]));
      broadcasts++;
      return {
        status: "unknown",
        requestId: quote.requestId,
        digest: "original",
        journalSynced: true,
      };
    },
  };
  (controller as any).results = {
    preflight: async () => async () => assertLive(),
  };
  (controller as any).coordinator = {
    prepareCommand: async () => {
      duringChallenge();
      return {
        send: async () => {
          deliveries++;
          return { success: true };
        },
      };
    },
  };
  return {
    controller,
    source,
    signer,
    queried,
    sourceActions,
    counts: () => ({
      nativeCalls,
      builds,
      broadcasts,
      deliveries,
      signs,
      sourceReads,
    }),
    change: () => {
      pin = "changed";
    },
    close: () => {
      live = false;
    },
    onNative: (fn: () => void) => {
      duringNative = fn;
    },
    onQuote: (fn: () => void) => {
      duringQuote = fn;
    },
    onChallenge: (fn: () => void) => {
      duringChallenge = fn;
    },
    original: (v: SelfPayTransactionOutcome) => {
      prior.set(v.requestId, v);
    },
  };
}
test("standing authority rejects invalid tools and preserves separate approval reasons", () => {
  const p = { ...policy(), actions: [...policy().actions] };
  assert.equal(standingInput(p).maxCalls, "3");
  for (const change of [
    { actions: ["shell"] },
    { maxCalls: "1001" },
    { budgetLimit: "2" },
    { paths: {} },
    { expiresAtMs: "0" },
  ])
    assert.throws(() => standingInput({ ...p, ...change } as any));
  const permission = {
    allowed_actions: ["status", "file.write"],
    max_calls: "3",
    budget_limit: "6",
    spent: "2",
    reserved: "2",
    boundary_hash: Array.from(executionBoundaryHash(paths)),
  };
  const request = {
    message: "Write the bounded file",
    bounds: { paths, max_calls: "5" },
    task: "explicit task",
  };
  assert.deepEqual(
    directApprovalReasons(permission, "file.write", request, {
      protected: true,
      complete: true,
    }),
    ["per_message_limit", "budget", "okr_workspace"],
  );
  assert.deepEqual(
    directApprovalReasons(
      permission,
      "status",
      { message: "Status", bounds: { paths, max_calls: "0" } },
      { protected: true, complete: true },
    ),
    [],
  );
});
test("permission quotations reject authority changes during native encryption or fee preparation", async (t) => {
  for (const at of ["native", "quote"] as const)
    await t.test(at, async () => {
      const f = await fixture();
      if (at === "native") f.onNative(f.change);
      else f.onQuote(f.change);
      await assert.rejects(
        f.controller.prepare({
          kind: "permission",
          expectedVersion: null,
          policy: { ...policy(), actions: [...policy().actions] },
        }),
        DirectAgentError,
      );
      assert.equal(f.counts().broadcasts, 0);
      assert.equal(f.counts().signs, 0);
      if (at === "native") assert.equal(f.counts().builds, 0);
    });
});
test("original unknown transaction is queried before new sources or crypto", async () => {
  const f = await fixture(),
    original = {
      status: "unknown",
      digest: "original",
      requestId: `direct-permission:${managed}:create`,
      journalSynced: true,
    } as SelfPayTransactionOutcome;
  f.original(original);
  assert.equal(
    await f.controller.prepare({
      kind: "permission",
      expectedVersion: null,
      policy: { ...policy(), actions: [...policy().actions] },
    }),
    original,
  );
  assert.deepEqual(f.counts(), {
    nativeCalls: 0,
    builds: 0,
    broadcasts: 0,
    deliveries: 0,
    signs: 0,
    sourceReads: 0,
  });
  assert.deepEqual(f.queried, [original.requestId]);
});

test("every fixed-ID preparation only queries its exact unknown original without another fee or signature", async (t) => {
  const operations: Array<[DirectOperation, string]> = [
    [
      {
        kind: "permission",
        expectedVersion: "2",
        policy: { ...policy(), actions: [...policy().actions] },
      },
      `direct-permission:${managed}:2`,
    ],
    [{ kind: "revoke", expectedVersion: "2" }, `direct-revoke:${managed}:2`],
    [{ kind: "approval", messageId }, `direct-approval:${messageId}`],
    [
      { kind: "decision", messageId, approve: true },
      `direct-decision:${messageId}:true`,
    ],
    [
      { kind: "decision", messageId, approve: false },
      `direct-decision:${messageId}:false`,
    ],
    [{ kind: "capability", messageId }, `direct-capability:${messageId}`],
    [
      { kind: "run", messageId, capabilityId: capability },
      `direct-run:${messageId}`,
    ],
    [{ kind: "stop", messageId }, `direct-stop:${messageId}`],
  ];
  for (const [operation, requestId] of operations)
    await t.test(requestId, async () => {
      const f = await fixture();
      const original: SelfPayTransactionOutcome = {
        status: "unknown",
        requestId,
        digest: "original-pruned-digest",
        journalSynced: true,
      };
      f.original(original);
      assert.equal(await f.controller.prepare(operation), original);
      assert.deepEqual(f.queried, [requestId]);
      assert.deepEqual(f.counts(), {
        nativeCalls: 0,
        builds: 0,
        broadcasts: 0,
        deliveries: 0,
        signs: 0,
        sourceReads: 0,
      });
      assert.equal(original.status, "unknown");
    });
});

async function decisionFixture() {
  const f = await fixture();
  f.source.permission = {
    id: permission,
    version: "1",
    revoked: false,
    human_generation: "1",
    managed_version: "1",
    membership_id: member,
    membership_version: "1",
    workspace_hash: f.source.managed.workspace_hash,
    expires_at_ms: String(Date.now() + 3600000),
  };
  const linked = {
    message: {
      id: messageId,
      permission_version: "1",
      managed_version: "1",
      human_generation: "1",
      expires_at_ms: String(Date.now() + 120000),
      message_token: "12345678-1234-1234-1234-123456789abc",
    },
    approval: { id: id("e"), state: 0 } as { id: string; state: number } | null,
    result: null as { run: { id: string } } | null,
    request: {
      message: "Explicit one-off request",
      bounds: { paths, max_calls: "3" },
    },
  };
  (f.controller as any).message = async (requested: string) => {
    assert.equal(requested, messageId);
    return structuredClone(linked);
  };
  const original: SelfPayTransactionOutcome = {
    status: "unknown",
    requestId: `direct-approval:${messageId}`,
    digest: "pruned-approval-creation",
    journalSynced: true,
  };
  f.original(original);
  return { ...f, linked, originalReceipt: original };
}

test("an independently linked pending approval permits the next decision despite the original creation receipt being unknown", async () => {
  const f = await decisionFixture(),
    original = structuredClone(f.originalReceipt);
  const quote = await f.controller.prepare({
    kind: "decision",
    messageId,
    approve: true,
  });
  assert.ok(!("status" in quote));
  assert.equal(quote.requestId, `direct-decision:${messageId}:true`);
  assert.deepEqual(f.queried, [`direct-decision:${messageId}:true`]);
  assert.ok(f.counts().sourceReads >= 2);
  assert.ok(f.sourceActions.every((action) => action === "approve"));
  assert.equal(f.counts().builds, 1);
  assert.equal(f.counts().broadcasts, 0);
  assert.equal(f.counts().signs, 0);
  assert.deepEqual(f.originalReceipt, original);
  // Fresh chain source changes after the preview still prevent signing.
  f.change();
  await assert.rejects(f.controller.submit(quote), DirectAgentError);
  assert.equal(f.counts().signs, 0);
  assert.equal(f.counts().broadcasts, 0);
});

test("the independent decision still rejects missing/decided approval, existing Run and changing authority", async (t) => {
  const mutations: Array<
    [string, (f: Awaited<ReturnType<typeof decisionFixture>>) => void]
  > = [
    [
      "missing approval",
      (f) => {
        f.linked.approval = null;
      },
    ],
    [
      "already decided",
      (f) => {
        f.linked.approval!.state = 1;
      },
    ],
    [
      "original Run exists",
      (f) => {
        f.linked.result = { run: { id: runId } };
      },
    ],
    [
      "permission revoked",
      (f) => {
        f.source.permission.revoked = true;
      },
    ],
    [
      "expired message",
      (f) => {
        f.linked.message.expires_at_ms = "1";
      },
    ],
    [
      "source changes during crypto",
      (f) => {
        f.onNative(f.change);
      },
    ],
  ];
  for (const [name, mutate] of mutations)
    await t.test(name, async () => {
      const f = await decisionFixture();
      mutate(f);
      await assert.rejects(
        f.controller.prepare({ kind: "decision", messageId, approve: true }),
        DirectAgentError,
      );
      assert.equal(f.counts().builds, 0);
      assert.equal(f.counts().signs, 0);
      assert.equal(f.counts().broadcasts, 0);
    });
});
test("permission submit rechecks after native signing and rejects foreign quotes", async () => {
  const f = await fixture(),
    quote = await f.controller.prepare({
      kind: "permission",
      expectedVersion: null,
      policy: { ...policy(), actions: [...policy().actions] },
    });
  assert.ok(!("status" in quote));
  await assert.rejects(f.controller.submit({ ...quote }), DirectAgentError);
  f.onNative(f.change);
  await assert.rejects(f.controller.submit(quote), DirectAgentError);
  assert.equal(f.counts().signs, 1);
  assert.equal(f.counts().broadcasts, 0);
});
async function sendingFixture() {
  const f = await fixture();
  const command = await signNodeCommand(f.signer, {
    target: {
      organizationId: org,
      nodeId: host,
      agentId: f.source.managed.instance_id,
    },
    action: "direct.message",
    scope: "direct",
    capability: { id: capability, revocationVersion: 1n },
    budget: { asset: "TOOL_CALLS", amount: 3n },
    payload: {},
  });
  f.source.permission = {
    id: permission,
    version: "1",
    revoked: false,
    human_generation: "1",
    managed_version: "1",
    membership_id: member,
    membership_version: "1",
    workspace_hash: f.source.managed.workspace_hash,
    expires_at_ms: String(Date.now() + 3600000),
    allowed_actions: ["file.write"],
    max_calls: "3",
    budget_limit: "3",
    spent: "0",
    reserved: "3",
    boundary_hash: Array.from(executionBoundaryHash(paths)),
  };
  (f.controller as any).pendingDelivery = {
    command,
    runId,
    messageId,
    attempted: false,
  };
  (f.controller as any).message = async () => ({
    message: {
      action: "file.write",
      budget_amount: "3",
      boundary_hash: f.source.permission.boundary_hash,
    },
    result: {
      run: {
        id: runId,
        capability_id: capability,
        state: 0,
        stop_requested: false,
        intent_hash: Array.from(nodeCommandIntentHash(command)),
      },
    },
    claim: { settled: false, permission_version: "1" },
    approval: null,
    workspace: { protected: false, complete: true },
    reasons: ["budget"],
  });
  return f;
}
test("a prepared full-budget reservation can send once; it is not charged against remaining allowance twice", async () => {
  const f = await sendingFixture();
  let saved = false;
  await f.controller.send(messageId, async () => {
    assert.equal(f.counts().deliveries, 0);
    saved = true;
  });
  assert.equal(saved, true);
  assert.equal(f.counts().deliveries, 1);
  await assert.rejects(
    f.controller.send(messageId, async () => {}),
    DirectAgentError,
  );
  assert.equal(f.counts().deliveries, 1);
});
test("failed durable delivery marker or closed scope prevents sending and subsequent replay", async (t) => {
  for (const mode of ["persist", "closed", "source"] as const)
    await t.test(mode, async () => {
      const f = await sendingFixture();
      if (mode === "source") f.onChallenge(f.change);
      await assert.rejects(
        f.controller.send(messageId, async () => {
          if (mode === "persist") throw new Error("disk unavailable");
          if (mode === "closed") f.close();
        }),
      );
      assert.equal(f.counts().deliveries, 0);
      if (mode !== "source")
        assert.equal(f.controller.canSend(messageId), false);
    });
});
test("restored controller does not infer authority to resend an original queued Run", async () => {
  const f = await fixture();
  assert.equal(f.controller.canSend(messageId), false);
  await assert.rejects(
    f.controller.send(messageId, async () => {}),
    DirectAgentError,
  );
  assert.equal(f.counts().deliveries, 0);
});

test("message expiry respects a lagging Sui Clock before quoting or signing", async () => {
  const f = await sendingFixture();
  f.source.authority.clockMs = BigInt(Date.now() - 90000);
  const original = (
    f.controller.chain.sdk.directAgent as any
  ).createMessage.bind(f.controller.chain.sdk.directAgent);
  let expiry = 0n;
  (f.controller.chain.sdk.directAgent as any).findMessage = async () => null;
  (f.controller.chain.sdk.directAgent as any).createMessage = (input: any) => {
    expiry = BigInt(input.expiresAtMs);
    return original(input);
  };
  await f.controller.prepare({
    kind: "message",
    messageToken: crypto.randomUUID(),
    action: "status",
    request: { message: "Query status", bounds: { paths, max_calls: "0" } },
  });
  assert.ok(expiry <= f.source.authority.clockMs + 240000n);
  assert.ok(expiry > BigInt(Date.now()));
  assert.equal(f.counts().broadcasts, 0);
});

test("stopping an original queued Run remains available after permission expiry and revocation", async () => {
  const f = await sendingFixture();
  f.source.permission.revoked = true;
  f.source.permission.expires_at_ms = "1";
  const quote = await f.controller.prepare({ kind: "stop", messageId });
  assert.ok(!("status" in quote));
  assert.equal(f.counts().builds, 1);
  assert.equal(f.counts().broadcasts, 0);
  assert.equal(f.counts().deliveries, 0);
});
