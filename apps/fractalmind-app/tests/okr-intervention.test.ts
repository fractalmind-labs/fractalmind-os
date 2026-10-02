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
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  OkrIntervention,
  OkrInterventionError,
  interventionRequestId,
  specificationDraft,
} from "../src/okr-intervention";
import { normalizeDraft, type DraftInput } from "../src/okr-draft";
import { NativeDeviceSigner } from "../src/native-device";
import type { ChainReadSession } from "../src/chain";
const org = id("1"),
  human = id("2"),
  grant = id("3"),
  okrId = id("4"),
  runId = id("5"),
  capability = id("6"),
  managed = id("7");
const draft = (): DraftInput => ({
  objective: "Ship an approved result",
  successCriteria: "The file is independently accepted",
  priority: 1,
  deadlineMs: String(Date.now() + 7200000),
  allowedPaths: ["docs"],
  prohibitedActions: ["external network", "no shell", "write outside project"],
  maxCalls: "6",
  krs: [
    {
      title: "Result",
      unit: "files",
      precision: 0,
      baseline: "0",
      target: "1",
      weight: "1",
      maxAgeMinutes: "60",
      verificationRule: "Review the original file and hash",
    },
  ],
});
// Fee/source race fixture. Production SDK builders and native signature wrapper
// are real. This does not prove the full OS/source/Host end-to-end journey.
async function fixture() {
  const key = Ed25519Keypair.generate();
  let live = true,
    pin = "initial",
    builds = 0,
    signs = 0,
    broadcasts = 0,
    reads = 0,
    encryptions = 0;
  let onNative = () => {},
    onQuote = () => {},
    prior: SelfPayTransactionOutcome | undefined;
  const actions: string[] = [];
  const plaintexts: any[] = [];
  const transactions: any[] = [];
  const assertLive = () => {
    if (!live) throw new OkrInterventionError("state_changed");
  };
  const native = async (command: string, args: Record<string, string>) => {
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: args.profile,
        address: key.toSuiAddress(),
        signingPublicKey: key.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(new Uint8Array(32)),
      };
    onNative();
    if (command === "fm_device_sign_transaction") {
      signs++;
      return key.signTransaction(fromBase64(args.bytes));
    }
    assert.equal(command, "fm_device_encrypt_record");
    encryptions++;
    const record = JSON.parse(args.record);
    plaintexts.push({
      ...record,
      plaintext: JSON.parse(
        new TextDecoder().decode(fromBase64(record.plaintext)),
      ),
    });
    const bytes = new Uint8Array(40);
    bytes.set(new TextEncoder().encode("FME1"));
    return toBase64(bytes);
  };
  const signer = await NativeDeviceSigner.load(native, "test-intervention");
  const sdk = new FractalMindSDK({
    packageId: id("a"),
    okrPackageId: id("b"),
    client: { core: {} } as any,
  });
  const chain = {
    profile: { network: "localnet", humanId: human },
    checkNetwork: async () => "fixture",
    sdk,
  } as unknown as ChainReadSession;
  const controller = new OkrIntervention(
    chain,
    signer,
    grant,
    org,
    okrId,
    native,
    new MemoryTransactionJournal(),
    assertLive,
  );
  const source = {
    authority: {
      authorityPin: "initial",
      humanId: human,
      actions: ["read", "operate", "approve"],
      encryptedKeys: { fixture: true },
      clockMs: BigInt(Date.now()),
      expiresAtMs: String(Date.now() + 3600000),
    },
    okr: {
      id: okrId,
      version: "2",
      state: 1,
      agreement_version: "1",
      logical_id: "fixture",
      spec_revision: "1",
      agreement_record: id("9"),
      managed_agent: managed,
    },
    spec: { keyVersion: "1", pointer: { record_id: id("8"), revision: "1" } },
    agreement: {
      keyVersion: "1",
      pointer: { record_id: id("9"), revision: "1" },
    },
  };
  (controller as any).source = async (action = "read") => {
    assertLive();
    reads++;
    actions.push(action);
    return structuredClone({ ...source, pin });
  };
  const rows = [
    {
      run: {
        id: runId,
        state: 0,
        capability_id: capability,
        stop_requested: false,
      },
      claim: {
        settled: false,
        agreement_version: "1",
        reserved: "3",
        spent: "0",
      },
    },
  ];
  (controller as any).executions = async () => structuredClone(rows);
  const budget = {
      asset: "TOOL_CALLS",
      spent: 3n,
      reserved: 0n,
      claimsId: id("c"),
    },
    coverage = { revision: "1", unsettledControl: 0 };
  (sdk.okr as any).getBudget = async () => structuredClone(budget);
  (sdk.nodeExecution as any).readAgentExecutions = async () =>
    structuredClone(coverage);
  const sign = (controller as any).manager.options.signer.signTransaction;
  (controller as any).manager = {
    query: async () => prior,
    prepare: async (input: any) => {
      builds++;
      transactions.push(input.transaction.getData());
      onQuote();
      return Object.freeze({
        requestId: input.requestId,
        expiresAtMs: Date.now() + 60000,
      });
    },
    submit: async (quote: any) => {
      await sign(new Uint8Array([1]));
      assertLive();
      broadcasts++;
      return {
        status: "unknown",
        requestId: quote.requestId,
        digest: "original",
      };
    },
  };
  return {
    controller,
    source,
    rows,
    budget,
    coverage,
    actions,
    plaintexts,
    transactions,
    setPrior: (value: SelfPayTransactionOutcome) => (prior = value),
    change: () => {
      pin = "changed";
    },
    close: () => {
      live = false;
    },
    onNative: (fn: () => void) => (onNative = fn),
    onQuote: (fn: () => void) => (onQuote = fn),
    counts: () => ({ builds, signs, broadcasts, reads, encryptions }),
  };
}
test("specification editor round-trips exact u64 decimal metrics; request IDs fit durable journal limits", () => {
  const input = draft();
  input.krs[0] = {
    ...input.krs[0],
    precision: 6,
    baseline: "9000000000000.000001",
    target: "9000000000000.000002",
    unit: "units",
  };
  const spec = normalizeDraft(input);
  assert.deepEqual(normalizeDraft(specificationDraft(spec)), spec);
  assert.ok(
    interventionRequestId(okrId, {
      kind: "pause",
      expectedVersion: "18446744073709551615",
    }).length <= 128,
  );
  assert.ok(
    interventionRequestId(okrId, { kind: "stop", runId }).length <= 128,
  );
  assert.throws(
    () =>
      interventionRequestId(okrId, {
        kind: "replace",
        expectedVersion: "18446744073709551616",
      }),
    OkrInterventionError,
  );
});
test("pause encrypts its reason and original agreement pointer without cancelling or clearing pending Run budgets", async () => {
  const f = await fixture();
  f.budget.reserved = 3n;
  f.coverage.unsettledControl = 1;
  const quote = await f.controller.prepare(
    { kind: "pause", expectedVersion: "2" },
    { reviewed: true, reason: "Review a blocked operation" },
  );
  assert.ok(!("status" in quote));
  assert.deepEqual(f.actions, ["operate", "operate", "operate"]);
  assert.equal(f.plaintexts[0].revision, "2");
  assert.equal(f.plaintexts[0].kind, 2);
  assert.equal(f.plaintexts[0].plaintext.priorAgreementRecord, id("9"));
  const commands = f.transactions[0].commands;
  assert.equal(commands.length, 1);
  assert.equal(commands[0].MoveCall.function, "pause");
  assert.equal(f.budget.reserved, 3n);
  assert.equal(f.rows[0].claim.settled, false);
  assert.equal(f.counts().broadcasts, 0);
});
test("original intervention receipt precedes source reads, confirmation and native encryption", async () => {
  const f = await fixture();
  f.setPrior({
    status: "unknown",
    requestId: interventionRequestId(okrId, {
      kind: "pause",
      expectedVersion: "2",
    }),
    digest: "original",
  } as any);
  f.close();
  // Scope closure correctly forbids even an original query; use a live fresh fixture.
  const live = await fixture();
  live.setPrior({
    status: "unknown",
    requestId: interventionRequestId(okrId, {
      kind: "pause",
      expectedVersion: "2",
    }),
    digest: "original",
  } as any);
  const result = await live.controller.prepare(
    { kind: "pause", expectedVersion: "2" },
    { reviewed: false },
  );
  assert.ok("status" in result);
  assert.equal(live.counts().reads, 0);
  assert.equal(live.counts().encryptions, 0);
  assert.equal(live.counts().builds, 0);
});
test("intervention quotation and native signing reject changed or closed source without broadcasting", async (t) => {
  for (const mode of ["encrypt", "quote", "sign", "closed"] as const)
    await t.test(mode, async () => {
      const f = await fixture();
      if (mode === "encrypt") f.onNative(f.change);
      if (mode === "quote") f.onQuote(f.change);
      const prepare = () =>
        f.controller.prepare(
          { kind: "pause", expectedVersion: "2" },
          { reviewed: true, reason: "Inspect the goal" },
        );
      if (mode === "encrypt" || mode === "quote")
        await assert.rejects(prepare(), OkrInterventionError);
      else {
        const quote = await prepare();
        assert.ok(!("status" in quote));
        if (mode === "closed") f.close();
        else f.onNative(f.change);
        await assert.rejects(
          f.controller.submit(quote as any),
          OkrInterventionError,
        );
      }
      assert.equal(f.counts().broadcasts, 0);
    });
});
test("historical stop uses the original OKR settlement route after pause and never edits the standing permission", async () => {
  const f = await fixture();
  f.source.okr.state = 2;
  f.source.okr.agreement_version = "9";
  const quote = await f.controller.prepare(
    { kind: "stop", runId },
    { reviewed: true },
  );
  assert.ok(!("status" in quote));
  assert.equal(
    f.transactions[0].commands[0].MoveCall.function,
    "request_stop_v2",
  );
  assert.equal(f.transactions[0].commands[0].MoveCall.package, id("b"));
  assert.equal(f.counts().encryptions, 0);
  assert.equal(f.counts().broadcasts, 0);
  f.rows[0].run.stop_requested = true;
  await assert.rejects(f.controller.submit(quote as any), OkrInterventionError);
  assert.equal(f.counts().broadcasts, 0);
});
test("specification replacement requires pause, zero pending control and sufficient retained budget", async (t) => {
  for (const mode of [
    "active",
    "reserved",
    "unsettled",
    "spent",
    "valid",
  ] as const)
    await t.test(mode, async () => {
      const f = await fixture();
      f.source.okr.state = mode === "active" ? 1 : 2;
      if (mode === "reserved") f.budget.reserved = 3n;
      if (mode === "unsettled") f.coverage.unsettledControl = 1;
      if (mode === "spent") f.budget.spent = 7n;
      const prepare = () =>
        f.controller.prepare(
          { kind: "replace", expectedVersion: "2" },
          { reviewed: true, replacement: draft() },
        );
      if (mode !== "valid")
        await assert.rejects(prepare(), OkrInterventionError);
      else {
        const quote = await prepare();
        assert.ok(!("status" in quote));
        assert.equal(
          f.transactions[0].commands[0].MoveCall.function,
          "replace_spec",
        );
        assert.equal(f.plaintexts[0].kind, 1);
        assert.equal(f.plaintexts[0].revision, "2");
        assert.equal(f.budget.spent, 3n);
        f.coverage.revision = "2";
        await assert.rejects(
          f.controller.submit(quote as any),
          OkrInterventionError,
        );
      }
      assert.equal(f.counts().broadcasts, 0);
    });
});
