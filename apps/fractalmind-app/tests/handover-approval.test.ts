import test from "node:test";
import assert from "node:assert/strict";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  fromBase64,
  normalizeSuiAddress as id,
  toBase64,
} from "@mysten/sui/utils";
import {
  HostMembershipBcs,
  CoordinatorBindingBcs,
  HostIndexBcs,
  ManagedAgentBcs,
  OkrBcs,
  MemoryTransactionJournal,
  signNodeCommand,
  type HandoverProposal,
  type NativeFileOkrPlan,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { OrganizationBcs } from "../src/device-identity";
import { NativeDeviceSigner } from "../src/native-device";
import { normalizeDraft } from "../src/okr-draft";
import { HandoverApproval } from "../src/handover-approval";
import type { ChainReadSession } from "../src/chain";

async function fixture() {
  const key = Ed25519Keypair.generate(),
    host = Ed25519Keypair.generate();
  const org = id("1"),
    human = id("2"),
    grant = id("3"),
    memberId = id("4"),
    bindingId = id("5"),
    managedId = id("6"),
    okrId = id("7"),
    executionId = id("8"),
    pkg = id("9"),
    active = id("a"),
    instances = id("b");
  const now = Date.now(),
    table = { id: id("c"), size: "0" },
    instance = "native-" + "aa".repeat(32);
  const organization = {
    id: org,
    name: "Fixture",
    description: "",
    admin: human,
    is_active: true,
    agents: table,
    agent_count: "0",
    tasks: table,
    task_count: "0",
    parent_org: null,
    child_orgs: table,
    child_org_count: "0",
    depth: "0",
    created_at: "1",
  };
  const member = {
    id: memberId,
    org_id: org,
    host_address: host.toSuiAddress(),
    host_public_key: Array.from(host.getPublicKey().toRawBytes()),
    encryption_public_key: Array(32).fill(4),
    name: "Host",
    coordinator_binding: bindingId,
    version: "1",
    revoked: false,
    expires_at_ms: String(now + 3600000),
    joined_at_ms: String(now),
    source_invite: id("d"),
    observation_capability: id("e"),
  };
  const binding = {
    id: bindingId,
    org_id: org,
    coordinator_address: key.toSuiAddress(),
    public_key: Array.from(key.getPublicKey().toRawBytes()),
    endpoint: "http://127.0.0.1:19000",
    version: "1",
    revoked: false,
  };
  const managed = {
    id: managedId,
    org_id: org,
    membership_id: memberId,
    host_address: host.toSuiAddress(),
    instance_id: instance,
    runtime: "bounded-process-v1",
    workspace_hash: Array(32).fill(8),
    control_confirmed: false,
    confirmed_by_human: human,
    confirmed_by_device: key.toSuiAddress(),
    version: "1",
    revoked: false,
    imported_at_ms: String(now),
  };
  const spec = normalizeDraft({
    objective: "Document the result",
    successCriteria: "Human checks README",
    priority: 1,
    deadlineMs: String(now + 3600000),
    allowedPaths: ["docs"],
    prohibitedActions: ["external network"],
    maxCalls: "9",
    krs: [
      {
        title: "README",
        unit: "files",
        precision: 0,
        baseline: "0",
        target: "1",
        weight: "1",
        maxAgeMinutes: "5",
        verificationRule: "Original evidence",
      },
    ],
  });
  const metric = {
    baseline: "0",
    target: "1",
    weight: "1",
    max_age_ms: "300000",
    current: null,
    sampled_at_ms: "0",
    run_id: null,
    evidence_id: null,
    verified: false,
    verification_id: null,
  };
  const okr = {
    id: okrId,
    org_id: org,
    owner_human: human,
    logical_id: "logical",
    state: 0,
    version: "1",
    agreement_version: "0",
    priority: 1,
    deadline_ms: spec.deadlineMs,
    spec_record: id("f"),
    spec_revision: "1",
    metrics: [metric],
    next_kr: "0",
    observations: table,
    managed_agent: null,
    managed_version: "0",
    membership_id: null,
    membership_version: "0",
    workspace_hash: [] as number[],
    boundary_hash: [] as number[],
    budget_asset: "",
    budget_limit: "0",
    expires_at_ms: "0",
    activated_at_ms: "0",
    agreement_record: null as string | null,
    acceptance_record: null,
    accepted_by_human: null,
    accepted_at_ms: "0",
  };
  const plan: NativeFileOkrPlan = {
    format: 1,
    paths: { "file.read": ["docs"], "file.write": ["docs"] },
    krs: [
      {
        maxCalls: "3",
        files: [{ path: "docs/README.md", content: "Evidence" }],
      },
    ],
  };
  const proposal: HandoverProposal = {
    version: "1",
    managed_agent_id: managedId,
    managed_version: "1",
    okr_id: okrId,
    okr_version: "1",
    spec_revision: "1",
    workspace_hash: "08".repeat(32),
    paths: structuredClone(plan.paths),
    budget_asset: "TOOL_CALLS",
    budget_limit: "9",
    max_calls: "3",
    expires_at_ms: now + 120000,
    nonce: "bb".repeat(32),
    review_expires_at_ms: now + 55000,
  };
  const command = await signNodeCommand(key, {
    target: {
      organizationId: org,
      nodeId: host.toSuiAddress(),
      agentId: instance,
    },
    action: "status",
    scope: "observation",
    capability: { id: id("10"), revocationVersion: 1n },
    expiresAtMs: now + 120000,
    payload: { handover_review: proposal },
  });
  let pin = "authority",
    clockMs = BigInt(now),
    currentMember = memberId,
    coverageRevision = "3",
    unsettled = 0,
    keyVersion = "1",
    reads = 0,
    encrypts = 0,
    signs = 0,
    broadcasts = 0,
    queries = 0;
  let duringEncryption = () => {},
    duringSign = () => {},
    duringQuote = () => {};
  let prior: SelfPayTransactionOutcome | null = null,
    encryptedAgreement: any,
    confirmation: any;
  const invoke = async (cmd: string, args: Record<string, string>) => {
    if (cmd === "fm_device_public")
      return {
        format: 1,
        profile: args.profile,
        address: key.toSuiAddress(),
        signingPublicKey: key.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(new Uint8Array(32)),
      };
    if (cmd === "fm_device_sign_transaction") {
      signs++;
      duringSign();
      return key.signTransaction(fromBase64(args.bytes));
    }
    assert.equal(cmd, "fm_device_encrypt_record");
    encrypts++;
    encryptedAgreement = JSON.parse(args.record);
    duringEncryption();
    const body = new Uint8Array(32);
    body.set(new TextEncoder().encode("FME1"));
    return toBase64(body);
  };
  const signer = await NativeDeviceSigner.load(invoke, "test-approval");
  const Pointer = bcs.struct("Pointer", {
    record_id: bcs.Address,
    membership_id: bcs.Address,
    runtime: bcs.string(),
    workspace_hash: bcs.vector(bcs.u8()),
    control_confirmed: bcs.bool(),
    revoked: bcs.bool(),
  });
  const core = {
    getObject: async ({ objectId }: { objectId: string }) => {
      const rows: Record<string, { type: string; content: Uint8Array }> = {
        [org]: {
          type: `${pkg}::organization::Organization`,
          content: OrganizationBcs.serialize(organization).toBytes(),
        },
        [memberId]: {
          type: `${pkg}::host::HostMembership`,
          content: HostMembershipBcs.serialize(member).toBytes(),
        },
        [bindingId]: {
          type: `${pkg}::host::CoordinatorBinding`,
          content: CoordinatorBindingBcs.serialize(binding).toBytes(),
        },
        [managedId]: {
          type: `${pkg}::host::ManagedAgent`,
          content: ManagedAgentBcs.serialize(managed).toBytes(),
        },
        [okrId]: {
          type: `${pkg}::okr::Okr`,
          content: OkrBcs.serialize(okr).toBytes(),
        },
      };
      assert.ok(rows[objectId]);
      return {
        object: {
          objectId,
          version: "1",
          owner: { $kind: "Shared" },
          ...rows[objectId],
        },
      };
    },
    getDynamicField: async ({
      parentId,
      name,
    }: {
      parentId: string;
      name: { type: string };
    }) => {
      if (parentId === org)
        return {
          dynamicField: {
            value: {
              type: `${pkg}::host::HostIndex`,
              bcs: HostIndexBcs.serialize({
                bindings: [bindingId],
                invitations: [],
                memberships: [memberId],
                active_hosts: { id: active, size: "1" },
                instances: { id: instances, size: "1" },
              }).toBytes(),
            },
          },
        };
      if (parentId === active) {
        assert.equal(name.type, "address");
        return {
          dynamicField: {
            value: {
              type: "0x2::object::ID",
              bcs: bcs.Address.serialize(currentMember).toBytes(),
            },
          },
        };
      }
      assert.equal(parentId, instances);
      return {
        dynamicField: {
          value: {
            type: `${pkg}::host::InstancePointer`,
            bcs: Pointer.serialize({
              record_id: managedId,
              membership_id: managed.membership_id,
              runtime: managed.runtime,
              workspace_hash: managed.workspace_hash,
              control_confirmed: managed.control_confirmed,
              revoked: managed.revoked,
            }).toBytes(),
          },
        },
      };
    },
  };
  const run = { id: executionId, result_record: id("11") };
  const head = { record_id: okr.spec_record, revision: "1", key_version: "1" };
  const chain = {
    profile: { network: "localnet", humanId: human },
    checkNetwork: async () => "fixture",
    human: async () => ({
      human: { organizations: [org] },
      clockMs,
      loadedAtMs: Date.now(),
    }),
    sdk: {
      client: { typesPackageId: pkg, okrTypesPackageId: pkg, client: { core } },
      productRecord: {
        getCurrent: async () => ({ ...head }),
        listCurrent: async () => ({
          keyVersion,
          records: [],
          hasNextPage: false,
          cursor: null,
        }),
      },
      nodeExecution: {
        readAgentExecutions: async () => ({
          managed: structuredClone(managed),
          revision: coverageRevision,
          unsettledControl: unsettled,
          executions: [{ run, control: false, settled: true }],
        }),
      },
      handover: {
        confirmOkr: async (v: any) => {
          confirmation = v;
          return new Transaction();
        },
      },
    },
  } as unknown as ChainReadSession;
  const controller = new HandoverApproval(
    chain,
    signer,
    grant,
    org,
    executionId,
    invoke,
    new MemoryTransactionJournal(),
  );
  (controller as any).verifier.verifyOrganization = async () => ({
    authorityPin: pin,
    humanId: human,
    actions: ["read", "operate", "approve", "manage_hosts"],
    expiresAtMs: String(now + 3600000),
    encryptedKeys: "opaque-ring",
  });
  (controller as any).results.readReview = async () => {
    reads++;
    if (clockMs >= BigInt(proposal.review_expires_at_ms))
      throw new Error("expired_review");
    return {
      run,
      acceptance: {
        version: "1",
        execution_id: executionId,
        organization_id: org,
        human_id: human,
        grant_id: grant,
        membership_id: memberId,
        binding_id: bindingId,
        host_address: host.toSuiAddress(),
        instance_id: instance,
        proposal,
        coverage_revision: "2",
        observed_at_ms: now,
        signature: "controlled-review-proof",
      },
    };
  };
  (controller as any).records.read = async () =>
    new TextEncoder().encode(JSON.stringify(spec));
  const manager = (controller as any).manager,
    guardedSigner = manager.options.signer;
  manager.query = async () => {
    queries++;
    return prior;
  };
  manager.prepare = async () => {
    duringQuote();
    return { requestId: controller.requestId } as SelfPayFeeQuote;
  };
  manager.submit = async () => {
    await guardedSigner.signTransaction(new Uint8Array([1, 2, 3]));
    broadcasts++;
    prior = {
      status: "confirmed",
      digest: "original",
      requestId: controller.requestId,
      journalSynced: true,
    };
    return prior;
  };
  return {
    controller,
    input: { command, nativeFilePlan: plan },
    member,
    binding,
    managed,
    okr,
    spec,
    head,
    guardedSigner,
    mutate: (v: {
      pin?: string;
      clock?: bigint;
      active?: string;
      coverage?: string;
      unsettled?: number;
      key?: string;
      duringEncryption?: () => void;
      duringSign?: () => void;
      duringQuote?: () => void;
      prior?: SelfPayTransactionOutcome;
    }) => {
      if (v.pin !== undefined) pin = v.pin;
      if (v.clock !== undefined) clockMs = v.clock;
      if (v.active !== undefined) currentMember = v.active;
      if (v.coverage !== undefined) coverageRevision = v.coverage;
      if (v.unsettled !== undefined) unsettled = v.unsettled;
      if (v.key !== undefined) keyVersion = v.key;
      if (v.duringEncryption) duringEncryption = v.duringEncryption;
      if (v.duringSign) duringSign = v.duringSign;
      if (v.duringQuote) duringQuote = v.duringQuote;
      if (v.prior) prior = v.prior;
    },
    counts: () => ({ reads, encrypts, signs, broadcasts, queries }),
    details: () => ({ encryptedAgreement, confirmation }),
    proposal,
  };
}
test("approval encrypts only exact reviewed plan and quotes; explicit submit signs once, never dispatches, repeats query original", async () => {
  const f = await fixture(),
    quote = (await f.controller.prepare(f.input)) as SelfPayFeeQuote;
  assert.equal(f.counts().signs, 0);
  assert.equal(f.counts().broadcasts, 0);
  const details = f.details();
  assert.equal(details.encryptedAgreement.encryptedKeys, "opaque-ring");
  assert.equal(details.encryptedAgreement.revision, "1");
  assert.equal(details.confirmation.expectedRecordRevision, "0");
  const agreement = JSON.parse(
    new TextDecoder().decode(fromBase64(details.encryptedAgreement.plaintext)),
  );
  assert.deepEqual(agreement.nativeFilePlan, f.input.nativeFilePlan);
  f.input.nativeFilePlan.krs[0].files[0].content = "mutated after quotation";
  const [a, b] = await Promise.all([
    f.controller.submit(quote),
    f.controller.submit(quote),
  ]);
  assert.equal(a.digest, b.digest);
  assert.equal(f.counts().signs, 1);
  assert.equal(f.counts().broadcasts, 1);
  f.member.revoked = true;
  assert.equal((await f.controller.prepare(f.input)).digest, "original");
  assert.equal((await f.controller.submit({ ...quote })).digest, "original");
});
test("current directory, managed/spec/metric/coverage drift reject before encryption or fee quotation", async () => {
  const mutations: Array<(f: Awaited<ReturnType<typeof fixture>>) => void> = [
    (f) => {
      f.member.revoked = true;
    },
    (f) => {
      f.binding.revoked = true;
    },
    (f) => f.mutate({ active: id("99") }),
    (f) => {
      f.managed.version = "2";
    },
    (f) => {
      f.managed.workspace_hash[0] = 9;
    },
    (f) => {
      f.managed.runtime = "tmux-observe";
    },
    (f) => {
      f.okr.version = "2";
    },
    (f) => {
      f.okr.spec_revision = "2";
    },
    (f) => {
      f.head.record_id = id("99");
    },
    (f) => f.mutate({ coverage: "4" }),
    (f) => f.mutate({ unsettled: 1 }),
    (f) => {
      f.okr.metrics[0].weight = "2";
    },
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(f.controller.prepare(f.input));
    assert.equal(f.counts().encrypts, 0);
    assert.equal(f.counts().signs, 0);
  }
});
test("native encryption and quotation waits cannot release stale quotes", async () => {
  for (const stage of ["duringEncryption", "duringQuote"] as const) {
    const f = await fixture();
    f.mutate({ [stage]: () => f.mutate({ key: "2" }) });
    await assert.rejects(f.controller.prepare(f.input), /state_changed/);
    assert.equal(f.counts().signs, 0);
  }
});
test("revocation or review expiry during native transaction signing blocks broadcast", async () => {
  for (const expired of [false, true]) {
    const f = await fixture(),
      quote = (await f.controller.prepare(f.input)) as SelfPayFeeQuote;
    f.mutate({
      duringSign: () =>
        expired
          ? f.mutate({ clock: BigInt(f.proposal.review_expires_at_ms) })
          : f.mutate({ pin: "revoked" }),
    });
    await assert.rejects(f.controller.submit(quote));
    assert.equal(f.counts().signs, 1);
    assert.equal(f.counts().broadcasts, 0);
  }
});
test("original unknown is queried despite lost current authority; forged quotes and direct signer have no authority", async () => {
  const f = await fixture();
  f.mutate({
    prior: {
      status: "unknown",
      digest: "same-original",
      requestId: f.controller.requestId,
      journalSynced: true,
    },
  });
  f.member.revoked = true;
  assert.equal((await f.controller.prepare(f.input)).digest, "same-original");
  assert.equal(f.counts().reads, 0);
  const g = await fixture(),
    quote = (await g.controller.prepare(g.input)) as SelfPayFeeQuote;
  await assert.rejects(g.controller.submit({ ...quote }), /invalid_quote/);
  await assert.rejects(
    g.guardedSigner.signTransaction(new Uint8Array([1])),
    /invalid_quote/,
  );
  assert.equal(g.counts().signs, 0);
});
