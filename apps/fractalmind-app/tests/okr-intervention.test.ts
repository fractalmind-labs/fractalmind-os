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
  directRequestHash,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  OkrIntervention,
  OkrInterventionError,
  interventionRequestId,
  independentPauseAfterUnknown,
  interventionHistory,
  rememberIntervention,
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
  let onNative = () => {}, onQuote = () => {}, onQuery = () => {};
  const prior = new Map<string, SelfPayTransactionOutcome>(), queried: string[] = [];
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
    return structuredClone({ ...source, pin: JSON.stringify([source, pin], (_k, v) => typeof v === "bigint" ? v.toString() : v) });
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
  let originalSpecification = normalizeDraft(draft());
  (controller as any).records.read = async () =>
    new TextEncoder().encode(JSON.stringify(originalSpecification));
  const sign = (controller as any).manager.options.signer.signTransaction;
  (controller as any).manager = {
    query: async (requestId: string) => {
      queried.push(requestId);
      onQuery();
      return prior.get(requestId);
    },
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
    queried,
    setPrior: (value: SelfPayTransactionOutcome) => prior.set(value.requestId, value),
    onQuery: (fn: () => void) => (onQuery = fn),
    setSpecification: (value: ReturnType<typeof normalizeDraft>) => {
      originalSpecification = value;
    },
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
test("a native read receipt detects changed original Runs, budgets and authority before projection publication", async (t) => {
  for (const mode of ["budget", "run", "authority"] as const)
    await t.test(mode, async () => {
      const f = await fixture(),
        spec = normalizeDraft(draft());
      Object.assign(f.source.okr, {
        priority: spec.priority,
        deadline_ms: spec.deadlineMs,
        metrics: spec.krs.map((k) => ({
          baseline: k.baseline,
          target: k.target,
          weight: k.weight,
          max_age_ms: k.maxAgeMs,
        })),
      });
      (f.controller as any).records.read = async () =>
        new TextEncoder().encode(JSON.stringify(spec));
      const view = await f.controller.read();
      await f.controller.assertCurrentRead(view);
      if (mode === "budget") f.budget.reserved = 3n;
      if (mode === "run") f.rows[0].run.state = 1;
      if (mode === "authority") f.change();
      await assert.rejects(f.controller.assertCurrentRead(view), {
        code: "state_changed",
      });
      assert.equal(f.counts().builds, 0);
      assert.equal(f.counts().signs, 0);
      assert.equal(f.counts().broadcasts, 0);
    });
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
test("specification revisions preserve original message provenance; removing or replacing it aborts before encryption", async (t) => {
  const request = {
    message: "Original discussion",
    bounds: { paths: { "file.read": ["docs"] }, max_calls: "0" },
  };
  const original = normalizeDraft({
    ...draft(),
    source: {
      schema: "fractalmind.okr-message-source.v1",
      network: "localnet",
      chainIdentifier: "testchain",
      organizationId: org,
      managedAgentId: managed,
      managedVersion: "1",
      membershipId: id("e"),
      messageId: id("f"),
      messageRecordId: id("10"),
      permissionId: id("11"),
      permissionVersion: "1",
      authorHumanId: human,
      authorDevice: id("12"),
      createdAtMs: "1000",
      action: "status",
      requestHash: Buffer.from(directRequestHash(request, "status")).toString(
        "hex",
      ),
      request,
    },
  });
  for (const mode of ["preserve", "remove", "replace"] as const)
    await t.test(mode, async () => {
      const f = await fixture();
      f.source.okr.state = 2;
      f.setSpecification(original);
      const replacement = specificationDraft(original);
      replacement.objective = "A revised goal";
      if (mode === "remove") delete replacement.source;
      if (mode === "replace") replacement.source!.messageId = id("13");
      const prepare = () =>
        f.controller.prepare(
          { kind: "replace", expectedVersion: "2" },
          { reviewed: true, replacement },
        );
      if (mode === "preserve") {
        const quote = await prepare();
        assert.ok(!("status" in quote));
        assert.deepEqual(f.plaintexts[0].plaintext.source, original.source);
      } else {
        await assert.rejects(prepare(), OkrInterventionError);
        assert.equal(f.counts().encryptions, 0);
      }
      assert.equal(f.counts().broadcasts, 0);
    });
});

test("an older unknown intervention allows a separately reviewed pause of the new version while preserving the original receipt", async (t) => {
  for (const kind of ["replace", "pause"] as const) await t.test(kind, async () => {
    const f = await fixture();
    f.source.okr.version = "3";
    const original = { status: "unknown", digest: "retained-original", requestId: interventionRequestId(okrId, { kind, expectedVersion: "1" }) } as SelfPayTransactionOutcome;
    const saved = structuredClone(original);
    f.setPrior(original);
    const quote = await f.controller.prepare({ kind: "pause", expectedVersion: "3" }, { reviewed: true, reason: "Stop for independent review", priorUnknown: [original] });
    assert.ok(!("status" in quote));
    assert.deepEqual(f.queried, [interventionRequestId(okrId, { kind: "pause", expectedVersion: "3" }), original.requestId]);
    assert.equal(f.transactions[0].commands[0].MoveCall.function, "pause");
    assert.equal(f.counts().broadcasts, 0);
    assert.equal((await f.controller.submit(quote)).requestId, quote.requestId);
    assert.equal(f.counts().broadcasts, 1);
    const counts = f.counts();
    assert.deepEqual(await f.controller.prepare({ kind, expectedVersion: "1" }, { reviewed: false }), saved);
    assert.deepEqual(f.counts(), counts);
    assert.deepEqual(original, saved);
    assert.deepEqual(await f.controller.query(original.requestId), saved);
  });
});

test("unknown history cannot release same-version, foreign, stop, malformed or unverified requests", async (t) => {
  for (const mode of ["same-version", "future-version", "foreign-okr", "stop", "malformed", "missing-original", "different-digest", "query-failed", "replace-intent", "paused", "wrong-current-version"] as const) await t.test(mode, async () => {
    const f = await fixture();
    f.source.okr.version = "3";
    let originalId = interventionRequestId(okrId, { kind: "replace", expectedVersion: mode === "same-version" ? "3" : mode === "future-version" ? "4" : "1" });
    if (mode === "foreign-okr") originalId = interventionRequestId(id("ff"), { kind: "replace", expectedVersion: "1" });
    if (mode === "stop") originalId = interventionRequestId(okrId, { kind: "stop", runId });
    if (mode === "malformed") originalId = "okr-intervene:untrusted";
    const original = { status: "unknown", digest: "retained-original", requestId: originalId } as SelfPayTransactionOutcome;
    if (mode !== "missing-original") f.setPrior({ ...original, digest: mode === "different-digest" ? "different" : original.digest });
    if (mode === "query-failed") f.onQuery(() => { throw new Error("RPC unavailable"); });
    if (mode === "paused") f.source.okr.state = 2;
    await assert.rejects(f.controller.prepare({ kind: mode === "replace-intent" ? "replace" : "pause", expectedVersion: mode === "wrong-current-version" ? "2" : "3" }, { reviewed: true, reason: "Pause", replacement: draft(), priorUnknown: [original] }));
    assert.equal(f.counts().builds, 0);
    assert.equal(f.counts().encryptions, 0);
    assert.equal(f.counts().signs, 0);
    assert.equal(f.counts().broadcasts, 0);
  });
});

test("the independent pause still requires explicit review and rejects quote or signing races", async (t) => {
  for (const mode of ["not-reviewed", "quote", "sign", "authority", "closed"] as const) await t.test(mode, async () => {
    const f = await fixture();
    f.source.okr.version = "3";
    const original = { status: "unknown", digest: "retained-original", requestId: interventionRequestId(okrId, { kind: "replace", expectedVersion: "1" }) } as SelfPayTransactionOutcome;
    f.setPrior(original);
    if (mode === "quote") f.onQuote(() => { f.source.okr.version = "4"; });
    const prepare = () => f.controller.prepare({ kind: "pause", expectedVersion: "3" }, { reviewed: mode !== "not-reviewed", reason: "Pause", priorUnknown: [original] });
    if (mode === "not-reviewed" || mode === "quote") await assert.rejects(prepare(), OkrInterventionError);
    else {
      const quote = await prepare();
      assert.ok(!("status" in quote));
      if (mode === "sign") f.onNative(() => { f.source.okr.version = "4"; });
      if (mode === "authority") f.change();
      if (mode === "closed") f.close();
      await assert.rejects(f.controller.submit(quote), OkrInterventionError);
    }
    assert.equal(f.counts().broadcasts, 0);
    assert.equal(original.status, "unknown");
  });
});

test("public history preserves legacy unknown locators across quotes and cold reopen; failed storage cannot overwrite them", () => {
  const old = interventionRequestId(okrId, { kind: "replace", expectedVersion: "1" }), next = interventionRequestId(okrId, { kind: "pause", expectedVersion: "3" });
  const values = new Map([["scope", old]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  rememberIntervention(storage, "scope", next);
  assert.equal(storage.getItem("scope"), old);
  assert.deepEqual(interventionHistory(storage, "scope"), [old, next]);
  // Cancelling a fee changes no locator; a fresh reader still finds both originals.
  assert.deepEqual(interventionHistory({ ...storage }, "scope"), [old, next]);
  rememberIntervention(storage, "scope", next);
  assert.deepEqual(interventionHistory(storage, "scope"), [old, next]);
  const another = interventionRequestId(okrId, { kind: "pause", expectedVersion: "5" });
  for (const setItem of [() => {}, () => { throw new Error("storage unavailable"); }])
    assert.throws(() => rememberIntervention({ ...storage, setItem }, "scope", another), { code: "journal_unavailable" });
  assert.deepEqual(interventionHistory(storage, "scope"), [old, next]);
  values.set("scope:history", "{}");
  assert.throws(() => rememberIntervention(storage, "scope", another), { code: "journal_unavailable" });
  assert.equal(storage.getItem("scope"), old);
  assert.equal(storage.getItem("scope:history"), "{}");
  const original = { status: "unknown", digest: "retained-original", requestId: old } as SelfPayTransactionOutcome;
  assert.equal(independentPauseAfterUnknown({ id: okrId, version: "3", state: 1 }, { kind: "stop", runId }, original), false);
});
