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
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { OkrControl } from "../src/okr-control";
import { NativeDeviceSigner, scopedNativeInvoke } from "../src/native-device";
import type { ChainReadSession } from "../src/chain";

// Controlled RPC and fee manager; signatures and authority BCS use production
// code. The native/localnet harness separately exercises the complete source.
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
    bindingId = id("a");
  let live = true,
    pin = "initial",
    signatures = 0,
    broadcasts = 0,
    builds = 0,
    onNative = () => {},
    onQuote = () => {},
    prior: SelfPayTransactionOutcome | undefined;
  const scope = () => {
    if (!live) throw new Error("scope closed");
  };
  const signer = await NativeDeviceSigner.load(
    scopedNativeInvoke(async (command, args) => {
      if (command === "fm_device_public")
        return {
          format: 1,
          profile: args.profile,
          address: key.toSuiAddress(),
          signingPublicKey: key.getPublicKey().toBase64(),
          encryptionPublicKey: toBase64(new Uint8Array(32)),
        };
      assert.equal(command, "fm_device_sign_transaction");
      signatures++;
      onNative();
      return key.signTransaction(fromBase64(args.bytes));
    }, scope),
    "test-control",
  );
  const authority = {
    authorityPin: "current",
    humanId: human,
    actions: ["read", "operate", "approve"],
    clockMs: BigInt(Date.now()),
    grantVersion: "1",
    generation: "1",
  };
  const okrRecord = {
    id: okr,
    org_id: org,
    owner_human: human,
    state: 1,
    version: "2",
    agreement_version: "1",
    next_kr: "0",
    managed_agent: managed,
    managed_version: "2",
    membership_id: member,
    membership_version: "1",
    workspace_hash: Array(32).fill(1),
    boundary_hash: Array(32).fill(2),
    expires_at_ms: String(Date.now() + 3600000),
    budget_asset: "TOOL_CALLS",
    budget_limit: "6",
    metrics: [
      {
        current: null as string | null,
        run_id: null as string | null,
        evidence_id: null as string | null,
      },
    ],
  };
  const managedRecord = {
    id: managed,
    org_id: org,
    host_address: host,
    instance_id: "native-" + "cc".repeat(32),
    membership_id: member,
    version: "2",
    workspace_hash: okrRecord.workspace_hash,
    runtime: "bounded-process-v1",
    control_confirmed: true,
    revoked: false,
  };
  const source = {
    authority,
    okr: okrRecord,
    managed: managedRecord,
    member: { id: member, version: "1", host_address: host },
    binding: { id: bindingId },
    policy: { max_calls: "3" },
  };
  const cap = {
    objectId: capability,
    type: `${pkg}::remote_authority::RemoteCapability`,
    parentId: null,
    revoked: false,
    orgId: org,
    delegate: signer.device.address,
    nodeId: host,
    agentId: managedRecord.instance_id,
    scope: "control",
    actions: ["assign"],
    maxUses: 1n,
    usesClaimed: 0n,
    usesDelegated: 0n,
    budgetClaimed: 0n,
    budgetDelegated: 0n,
    maxBudget: 3n,
    budgetAsset: "TOOL_CALLS",
    expiresAtMs: BigInt(okrRecord.expires_at_ms),
  };
  const binding = {
    human_id: human,
    device_grant: grant,
    device_grant_version: "1",
    human_generation: "1",
    membership_id: member,
    membership_version: "1",
    managed_agent: managed,
    managed_agent_version: "2",
    required_action: 2,
  };
  const contract = {
    contract_id: okr,
    agreement_version: "1",
    boundary_hash: okrRecord.boundary_hash,
  };
  const object = {
    objectId: capability,
    type: cap.type,
    owner: { $kind: "Shared" },
  };
  let bindingType = `${pkg}::host::AuthorityBinding`,
    issued: any;
  const chain = {
    profile: { network: "localnet", humanId: human },
    checkNetwork: async () => "fixture",
    sdk: {
      client: {
        typesPackageId: pkg,
        client: {
          core: {
            getObject: async () => ({ object }),
            getDynamicField: async () => ({
              dynamicField: {
                value: {
                  type: bindingType,
                  bcs: AuthorityBindingBcs.serialize(binding).toBytes(),
                },
              },
            }),
          },
        },
      },
      okr: {
        getOkr: async () => structuredClone(okrRecord),
        getCapabilityContract: async () => structuredClone(contract),
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
  const control = new OkrControl(
    chain,
    signer,
    grant,
    org,
    okr,
    "1",
    "0",
    new MemoryTransactionJournal(),
    scope,
  );
  const originalSource = (control as any).source;
  (control as any).source = async () => {
    scope();
    return { ...source, pin };
  };
  (control as any).verifier.verifyOrganization = async () => authority;
  const manager = (control as any).manager;
  manager.query = async () => prior;
  manager.prepare = async () => {
    onQuote();
    return Object.freeze({
      requestId: control.requestId,
      expiresAtMs: Date.now() + 60000,
    });
  };
  manager.submit = async () => {
    await manager.options.signer.signTransaction(new Uint8Array([1, 2]));
    broadcasts++;
    prior = {
      status: "confirmed",
      requestId: control.requestId,
      digest: "original",
      journalSynced: true,
    };
    return prior;
  };
  return {
    control,
    chain,
    authority,
    okrRecord,
    managedRecord,
    cap,
    binding,
    contract,
    object,
    originalSource,
    set: (v: {
      pin?: string;
      live?: boolean;
      native?: () => void;
      quoting?: () => void;
      prior?: SelfPayTransactionOutcome;
      bindingType?: string;
    }) => {
      if (v.pin) pin = v.pin;
      if (v.live !== undefined) live = v.live;
      if (v.native) onNative = v.native;
      if (v.quoting) onQuote = v.quoting;
      if (v.prior) prior = v.prior;
      if (v.bindingType) bindingType = v.bindingType;
    },
    counts: () => ({ signatures, broadcasts, builds }),
    issued: () => issued,
  };
}

test("current KR control quotation is read-only; own quote coalesces and original outcome is never reissued", async () => {
  const f = await fixture(),
    q = await f.control.prepare();
  assert.ok(!("status" in q));
  assert.equal(f.issued().maxUses, 1n);
  assert.equal(f.issued().okrId, f.okrRecord.id);
  assert.deepEqual(f.counts(), { signatures: 0, broadcasts: 0, builds: 1 });
  await assert.rejects(f.control.submit({ ...q }), /invalid_quote/);
  const [a, b] = await Promise.all([f.control.submit(q), f.control.submit(q)]);
  assert.deepEqual(a, b);
  assert.equal(f.counts().broadcasts, 1);
  f.set({ pin: "later authority" });
  assert.equal((await f.control.prepare()).requestId, a.requestId);
});
test("unknown original control request wins before current authorization and new transaction work", async () => {
  const f = await fixture();
  f.set({
    prior: {
      status: "unknown",
      requestId: f.control.requestId,
      digest: "original",
      journalSynced: true,
    },
  });
  (f.control as any).source = async () => {
    throw new Error("must not read fresh source");
  };
  assert.equal(
    ((await f.control.prepare()) as SelfPayTransactionOutcome).digest,
    "original",
  );
  assert.deepEqual(f.counts(), { signatures: 0, broadcasts: 0, builds: 0 });
});
test("simulation/native signing drift and closed scope prevent broadcast", async () => {
  const q = await fixture();
  q.set({ quoting: () => q.set({ pin: "changed during fee quote" }) });
  await assert.rejects(q.control.prepare(), /state_changed/);
  assert.equal(q.counts().signatures, 0);
  for (const close of [false, true]) {
    const f = await fixture(),
      quote = await f.control.prepare();
    assert.ok(!("status" in quote));
    f.set({
      native: () =>
        f.set(
          close ? { live: false } : { pin: "changed during native signature" },
        ),
    });
    await assert.rejects(
      f.control.submit(quote),
      close ? /native_unavailable/ : /state_changed/,
    );
    assert.equal(f.counts().broadcasts, 0);
  }
});
test("cached capability locator requires exact current contract and typed authority binding", async () => {
  const f = await fixture();
  assert.equal(
    (await f.control.use(f.cap.objectId)).capabilityId,
    f.cap.objectId,
  );
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.cap.type = id("ff") + "::remote_authority::RemoteCapability";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.object.owner.$kind = "AddressOwner";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.cap.delegate = id("ff");
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.cap.usesClaimed = 1n;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.cap.budgetDelegated = 1n;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.cap.expiresAtMs -= 1n;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.cap.actions.push("stop");
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.contract.agreement_version = "2";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.contract.boundary_hash = Array(32).fill(9);
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.binding.device_grant_version = "2";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.binding.managed_agent_version = "3";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.binding.required_action = 1;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.set({ bindingType: id("ff") + "::host::AuthorityBinding" });
    },
  ]) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(f.control.use(f.cap.objectId), /invalid_source/);
    assert.deepEqual(f.counts(), { signatures: 0, broadcasts: 0, builds: 0 });
  }
});
test("issuance refuses stale KR, existing measured evidence, observation-only adapter and unsettled control before a fee", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.authority.actions = ["read", "operate"];
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.okrRecord.next_kr = "1";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.okrRecord.metrics[0] = {
        current: "1",
        run_id: id("ab"),
        evidence_id: id("cd"),
      };
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.managedRecord.control_confirmed = false;
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
    mutate(f);
    (f.control as any).source = f.originalSource;
    await assert.rejects(
      f.control.prepare(),
      /invalid_source|state_changed|unsettled_execution/,
    );
    assert.deepEqual(f.counts(), { signatures: 0, broadcasts: 0, builds: 0 });
  }
});
