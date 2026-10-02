import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  normalizeSuiAddress as id,
  fromBase64,
  toBase64,
} from "@mysten/sui/utils";
import {
  AuthorityBindingBcs,
  MemoryTransactionJournal,
  verifySignedNodeCommand,
  type NativeFileOkrPlan,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { HandoverSetup } from "../src/handover-setup";
import { NativeDeviceSigner, scopedNativeInvoke } from "../src/native-device";
import { normalizeDraft } from "../src/okr-draft";
import type { ChainReadSession } from "../src/chain";

async function fixture() {
  const key = Ed25519Keypair.generate(),
    org = id("1"),
    human = id("2"),
    grant = id("3"),
    member = id("4"),
    host = id("5"),
    managed = id("6"),
    okr = id("7"),
    capability = id("8"),
    pkg = id("9"),
    binding = id("a");
  let pin = "initial",
    live = true,
    signatures = 0,
    broadcasts = 0,
    builds = 0,
    onNative = () => {},
    onQuote = () => {},
    prior: SelfPayTransactionOutcome | undefined;
  const signer = await NativeDeviceSigner.load(
    scopedNativeInvoke(
      async (command, args) => {
        if (command === "fm_device_public")
          return {
            format: 1,
            profile: args.profile,
            address: key.toSuiAddress(),
            signingPublicKey: key.getPublicKey().toBase64(),
            encryptionPublicKey: toBase64(new Uint8Array(32)),
          };
        signatures++;
        onNative();
        if (command === "fm_device_sign_node_command")
          return {
            bytes: args.bytes,
            signature: toBase64(await key.sign(fromBase64(args.bytes))),
          };
        assert.equal(command, "fm_device_sign_transaction");
        return key.signTransaction(fromBase64(args.bytes));
      },
      () => {
        if (!live) throw new Error("scope closed");
      },
    ),
    "test-setup",
  );
  const authority = {
    authorityPin: "current",
    humanId: human,
    actions: ["read", "operate", "approve", "manage_hosts"],
    clockMs: BigInt(Date.now()),
    expiresAtMs: String(Date.now() + 3600000),
    grantVersion: "1",
    generation: "1",
  };
  const managedRecord = {
    id: managed,
    org_id: org,
    membership_id: member,
    host_address: host,
    instance_id: "native-" + "cc".repeat(32),
    runtime: "bounded-process-v1",
    workspace_hash: Array(32).fill(170),
    version: "1",
    revoked: false,
  };
  const source = {
    authority,
    managed: managedRecord,
    member: {
      id: member,
      version: "1",
      expires_at_ms: String(Date.now() + 3600000),
    },
    binding: { id: binding },
    pin,
  };
  const cap = {
    objectId: capability,
    type: `${pkg}::remote_authority::RemoteCapability`,
    revoked: false,
    parentId: undefined,
    orgId: org,
    nodeId: host,
    agentId: managedRecord.instance_id,
    delegate: signer.device.address,
    scope: "observation",
    actions: ["status"],
    maxUses: 1n,
    usesClaimed: 0n,
    usesDelegated: 0n,
    maxBudget: 0n,
    budgetAsset: "",
    expiresAtMs: BigInt(Date.now() + 600000),
    revocationVersion: 1n,
  };
  const authorityBinding = {
    membership_id: member,
    membership_version: "1",
    managed_agent: managed,
    managed_agent_version: "1",
    human_id: human,
    device_grant: grant,
    device_grant_version: "1",
    human_generation: "1",
    required_action: 1,
  };
  let issued: any;
  const chain = {
    profile: { network: "localnet", humanId: human },
    checkNetwork: async () => "fixture",
    sdk: {
      client: {
        typesPackageId: pkg,
        client: {
          core: {
            getObject: async () => ({
              object: {
                objectId: capability,
                version: "1",
                owner: { $kind: "Shared" },
                type: cap.type,
              },
            }),
            getDynamicField: async () => ({
              dynamicField: {
                value: {
                  type: `${pkg}::host::AuthorityBinding`,
                  bcs: AuthorityBindingBcs.serialize(
                    authorityBinding,
                  ).toBytes(),
                },
              },
            }),
          },
        },
      },
      host: {
        issueCapability: (v: any) => {
          builds++;
          issued = v;
          return new Transaction();
        },
      },
      remoteAuthority: { getCapability: async () => structuredClone(cap) },
      nodeExecution: {
        readAgentExecutions: async () => ({
          managed: managedRecord,
          unsettledControl: 0,
        }),
      },
    },
  } as unknown as ChainReadSession;
  const setup = new HandoverSetup(
    chain,
    signer,
    grant,
    org,
    managed,
    "11111111-1111-4111-8111-111111111111",
    async () => {
      throw new Error("not used");
    },
    new MemoryTransactionJournal(),
  );
  const originalSource = (setup as any).source;
  (setup as any).source = async () => ({ ...source, pin });
  (setup as any).verifier.verifyOrganization = async () => authority;
  const spec = normalizeDraft({
    objective: "Produce the reviewed file",
    successCriteria: "Human reviews the content",
    priority: 1,
    deadlineMs: String(Date.now() + 3600000),
    allowedPaths: ["docs"],
    prohibitedActions: ["external network", "no shell"],
    maxCalls: "3",
    krs: [
      {
        title: "One file",
        unit: "files",
        precision: 0,
        baseline: "0",
        target: "1",
        weight: "1",
        maxAgeMinutes: "5",
        verificationRule: "Check the original file",
      },
    ],
  });
  const nativePlan: NativeFileOkrPlan = {
    format: 1,
    paths: { "file.read": ["docs"], "file.write": ["docs"] },
    krs: [
      {
        maxCalls: "3",
        files: [{ path: "docs/result.md", content: "Reviewed" }],
      },
    ],
  };
  (setup as any).specification = async () => ({
    source: { ...source, pin },
    okr: {
      id: okr,
      version: "2",
      spec_revision: "3",
      deadline_ms: spec.deadlineMs,
    },
    spec: structuredClone(spec),
    pin,
  });
  const manager = (setup as any).manager;
  manager.query = async () => prior;
  manager.prepare = async () => {
    onQuote();
    return Object.freeze({
      requestId: setup.requestId,
      expiresAtMs: Date.now() + 60000,
    });
  };
  manager.submit = async () => {
    await manager.options.signer.signTransaction(new Uint8Array([1, 2]));
    broadcasts++;
    prior = {
      status: "confirmed",
      requestId: setup.requestId,
      digest: "original",
      journalSynced: true,
    };
    return prior;
  };
  return {
    setup,
    chain,
    spec,
    nativePlan,
    okr,
    cap,
    authorityBinding,
    authority,
    managedRecord,
    originalSource,
    set: (v: {
      pin?: string;
      native?: () => void;
      quoting?: () => void;
      live?: boolean;
      prior?: SelfPayTransactionOutcome;
    }) => {
      if (v.pin) pin = v.pin;
      if (v.native) onNative = v.native;
      if (v.quoting) onQuote = v.quoting;
      if (v.live !== undefined) live = v.live;
      if (v.prior) prior = v.prior;
    },
    counts: () => ({ signatures, broadcasts, builds }),
    issued: () => issued,
  };
}
test("single-use observation fee does not sign or dispatch, exact quote coalesces and original outcome wins", async () => {
  const f = await fixture(),
    quote = await f.setup.prepare();
  assert.ok(!("status" in quote));
  assert.equal(f.issued().scope, "observation");
  assert.deepEqual(f.issued().actions, ["status"]);
  assert.equal(f.issued().maxUses, 1);
  assert.equal(f.issued().maxBudget, undefined);
  assert.equal(f.issued().budgetAsset, undefined);
  assert.deepEqual(f.counts(), { signatures: 0, broadcasts: 0, builds: 1 });
  await assert.rejects(f.setup.submit({ ...quote }), /invalid_quote/);
  const outcomes = await Promise.all([
    f.setup.submit(quote),
    f.setup.submit(quote),
  ]);
  assert.deepEqual(outcomes[0], outcomes[1]);
  assert.equal(f.counts().broadcasts, 1);
  f.set({ pin: "revoked later" });
  assert.equal((await f.setup.prepare()).requestId, outcomes[0].requestId);
});
test("quote/signing drift and closing the native dialog cannot release a signature for broadcast", async () => {
  const quoting = await fixture();
  quoting.set({
    quoting: () => quoting.set({ pin: "changed while simulating" }),
  });
  await assert.rejects(quoting.setup.prepare(), /state_changed/);
  assert.equal(quoting.counts().signatures, 0);
  const signing = await fixture(),
    quote = await signing.setup.prepare();
  assert.ok(!("status" in quote));
  signing.set({ native: () => signing.set({ pin: "changed while signing" }) });
  await assert.rejects(signing.setup.submit(quote), /state_changed/);
  assert.equal(signing.counts().broadcasts, 0);
  const closed = await fixture(),
    closeQuote = await closed.setup.prepare();
  assert.ok(!("status" in closeQuote));
  closed.set({ native: () => closed.set({ live: false }) });
  await assert.rejects(closed.setup.submit(closeQuote), /native_unavailable/);
  assert.equal(closed.counts().broadcasts, 0);
});
test("unknown original observation is queried before reading fresh authority or building another transaction", async () => {
  const f = await fixture();
  f.set({
    prior: {
      status: "unknown",
      digest: "original",
      requestId: f.setup.requestId,
      journalSynced: true,
    },
  });
  (f.setup as any).source = async () => {
    throw new Error("must not read new authority");
  };
  assert.equal(
    ((await f.setup.prepare()) as SelfPayTransactionOutcome).digest,
    "original",
  );
  assert.deepEqual(f.counts(), { signatures: 0, broadcasts: 0, builds: 0 });
});
test("review factory signs the current exact spec and bounded plan without creating a transaction", async () => {
  const f = await fixture(),
    request = await f.setup.createReview(
      f.okr,
      f.cap.objectId,
      f.nativePlan,
      f.spec,
    );
  await verifySignedNodeCommand(request.command);
  assert.equal(request.command.scope, "observation");
  assert.equal(request.command.action, "status");
  assert.equal(request.command.budget, undefined);
  const p = request.command.payload.handover_review as any;
  assert.equal(p.okr_version, "2");
  assert.equal(p.spec_revision, "3");
  assert.equal(p.budget_limit, "3");
  assert.deepEqual(request.nativeFilePlan, f.nativePlan);
  assert.equal(f.counts().builds, 0);
  f.nativePlan.krs[0].files[0].content = "changed afterward";
  assert.equal(request.nativeFilePlan.krs[0].files[0].content, "Reviewed");
});
test("review factory rejects stale native-signing snapshots, unsupported constraints, escaped paths and mismatched capability bindings", async () => {
  const signing = await fixture();
  signing.set({
    native: () => signing.set({ pin: "changed during signature" }),
  });
  await assert.rejects(
    signing.setup.createReview(
      signing.okr,
      signing.cap.objectId,
      signing.nativePlan,
    ),
    /state_changed/,
  );
  const changedGoal = await fixture(),
    previouslyRead = structuredClone(changedGoal.spec);
  changedGoal.spec.objective = "A different goal with identical file counts";
  await assert.rejects(
    changedGoal.setup.createReview(
      changedGoal.okr,
      changedGoal.cap.objectId,
      changedGoal.nativePlan,
      previouslyRead,
    ),
    /state_changed/,
  );
  assert.equal(changedGoal.counts().signatures, 0);
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) =>
      f.spec.constraints.prohibitedActions.push(
        "do not modify important files",
      ),
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.nativePlan.krs[0].files[0].path = "docs-other/escape.md";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.cap.scope = "control";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.cap.usesClaimed = 1n;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.authorityBinding.managed_agent_version = "2";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.authorityBinding.device_grant_version = "2";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.authorityBinding.required_action = 2;
    },
  ]) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(
      f.setup.createReview(f.okr, f.cap.objectId, f.nativePlan),
    );
    assert.equal(f.counts().signatures, 0);
    assert.equal(f.counts().builds, 0);
  }
});
test("current issuance source denies missing approval rights, observation-only runtime and unsettled control before a fee", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.authority.actions = ["read", "operate"];
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.managedRecord.runtime = "tmux-observe";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      (f.chain.sdk.nodeExecution as any).readAgentExecutions = async () => ({
        managed: f.managedRecord,
        unsettledControl: 1,
      });
    },
  ]) {
    const f = await fixture();
    change(f);
    (f.setup as any).source = f.originalSource;
    await assert.rejects(f.setup.prepare(), /invalid_source/);
    assert.equal(f.counts().builds, 0);
  }
});
