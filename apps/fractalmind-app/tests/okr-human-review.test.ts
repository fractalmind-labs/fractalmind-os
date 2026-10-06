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
  MemoryTransactionJournal,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDeviceSigner, scopedNativeInvoke } from "../src/native-device";
import {
  OkrHumanReview,
  reviewableEvidenceAgreement,
  type HumanReviewView,
} from "../src/okr-human-review";
import type { ChainReadSession } from "../src/chain";

// Controlled source and fees; native signature verification remains production.
// The actual envd/localnet harness exercises read(), history and Move transitions.
async function fixture(final = false) {
  const key = Ed25519Keypair.generate(),
    org = id("1"),
    human = id("2"),
    grant = id("3"),
    okr = id("4");
  let live = true,
    pin = "current",
    encryptions = 0,
    signatures = 0,
    broadcasts = 0,
    builds = 0;
  let prior: SelfPayTransactionOutcome | undefined,
    onNative = () => {},
    onEncrypt = () => {},
    onQuote = () => {};
  let args: any, operation: "verify" | "accept" | undefined, plaintext: any;
  const scope = () => {
    if (!live) throw new Error("scope closed");
  };
  const native = scopedNativeInvoke(async (command, input) => {
    if (command === "fm_device_public")
      return {
        format: 1,
        profile: input.profile,
        address: key.toSuiAddress(),
        signingPublicKey: key.getPublicKey().toBase64(),
        encryptionPublicKey: toBase64(new Uint8Array(32)),
      };
    if (command === "fm_device_encrypt_record") {
      encryptions++;
      const request = JSON.parse(input.record);
      plaintext = JSON.parse(
        new TextDecoder().decode(fromBase64(request.plaintext)),
      );
      onEncrypt();
      const body = new Uint8Array(40);
      body.set(new TextEncoder().encode("FME1"));
      return toBase64(body);
    }
    assert.equal(command, "fm_device_sign_transaction");
    signatures++;
    onNative();
    return key.signTransaction(fromBase64(input.bytes));
  }, scope);
  const signer = await NativeDeviceSigner.load(native, "test-human-review");
  const metric = {
    baseline: "0",
    target: "1",
    current: "1",
    sampled_at_ms: "1000",
    max_age_ms: "5000",
    run_id: id("5"),
    evidence_id: id("6"),
    verified: final,
    verification_id: final ? id("7") : null,
  };
  const okrRecord = {
    id: okr,
    logical_id: "fixture",
    org_id: org,
    owner_human: human,
    state: 1,
    version: "4",
    agreement_version: "1",
    next_kr: final ? "1" : "0",
    managed_agent: id("8"),
    agreement_record: id("9"),
    spec_record: id("a"),
    metrics: [metric],
  };
  const authority = {
    authorityPin: "authorized",
    humanId: human,
    actions: ["read", "approve"],
    encryptedKeys: "fixture",
    clockMs: 2000n,
  };
  const chain = {
    profile: { network: "localnet", humanId: human },
    checkNetwork: async () => "fixture",
    sdk: {
      client: { client: {} },
      okr: {
        getOkr: async () => structuredClone(okrRecord),
        verifyKr: (value: any) => {
          operation = "verify";
          args = value;
          builds++;
          return new Transaction();
        },
        achieve: (value: any) => {
          operation = "accept";
          args = value;
          builds++;
          return new Transaction();
        },
      },
    },
  } as unknown as ChainReadSession;
  const controller = new OkrHumanReview(
    chain,
    signer,
    grant,
    org,
    okr,
    {
      kind: final ? "accept" : "verify",
      okrVersion: "4",
      agreementVersion: "1",
      krIndex: final ? "1" : "0",
    },
    native,
    new MemoryTransactionJournal(),
    scope,
  );
  const originalSource = (controller as any).source;
  (controller as any).verifier.verifyOrganization = async () => authority;
  (controller as any).source = async () => {
    scope();
    return {
      authority,
      okr: okrRecord,
      specHead: { keyVersion: "1" },
      verificationHead: { pointer: final ? { revision: "1" } : undefined },
      selected: [{ index: 0, contract: { agreement_version: "1" } }],
      pin,
    };
  };
  const view = Object.freeze({
    okr: okrRecord,
    spec: {},
    evidence: [
      {
        krIndex: 0,
        metric,
        result: {
          run: { id: metric.run_id },
          recordId: metric.evidence_id,
          transactionDigest: "original-result-digest",
        },
        files: [],
      },
    ],
  }) as unknown as HumanReviewView;
  (controller as any).views.set(view, pin);
  const manager = (controller as any).manager;
  manager.query = async () => prior;
  manager.prepare = async () => {
    onQuote();
    return Object.freeze({
      requestId: controller.requestId,
      expiresAtMs: Date.now() + 60000,
    });
  };
  manager.submit = async () => {
    await manager.options.signer.signTransaction(new Uint8Array([1, 2]));
    broadcasts++;
    prior = {
      status: "confirmed",
      requestId: controller.requestId,
      digest: "original",
      journalSynced: true,
    };
    return prior;
  };
  return {
    controller,
    view,
    authority,
    okrRecord,
    originalSource,
    set: (v: {
      pin?: string;
      live?: boolean;
      native?: () => void;
      encrypt?: () => void;
      quote?: () => void;
      prior?: SelfPayTransactionOutcome;
    }) => {
      if (v.pin) pin = v.pin;
      if (v.live !== undefined) live = v.live;
      if (v.native) onNative = v.native;
      if (v.encrypt) onEncrypt = v.encrypt;
      if (v.quote) onQuote = v.quote;
      if (v.prior) prior = v.prior;
    },
    counts: () => ({ encryptions, signatures, broadcasts, builds }),
    built: () => ({ operation, args, plaintext }),
  };
}
const decision = {
  reviewed: true,
  reason: "I independently inspected the original file evidence.",
};
test("renewed agreements admit older results only for evidence review, with exact current boundaries for current-version results", () => {
  const original = Array(32).fill(1),
    current = Array(32).fill(2);
  assert.equal(reviewableEvidenceAgreement("1", "3", original, current), true);
  assert.equal(reviewableEvidenceAgreement("3", "3", current, current), true);
  assert.equal(reviewableEvidenceAgreement("3", "3", original, current), false);
  assert.equal(reviewableEvidenceAgreement("4", "3", original, current), false);
  assert.equal(reviewableEvidenceAgreement("0", "3", original, current), false);
  assert.equal(reviewableEvidenceAgreement("1", "3", [1], current), false);
});
test("Human KR verification requires an independent confirmation, reason and original view before encryption or fees", async () => {
  const f = await fixture();
  for (const input of [
    { reviewed: false, reason: "reason" },
    { reviewed: true, reason: " " },
    { reviewed: true, reason: "中".repeat(1366) },
  ])
    await assert.rejects(f.controller.prepare(f.view, input));
  await assert.rejects(
    f.controller.prepare({ ...f.view }, decision),
    /invalid_input/,
  );
  assert.deepEqual(f.counts(), {
    encryptions: 0,
    signatures: 0,
    broadcasts: 0,
    builds: 0,
  });
});
test("verification quote binds the original measurement and advances only KR; own quote coalesces into one submission", async () => {
  const f = await fixture(),
    q = await f.controller.prepare(f.view, decision);
  assert.ok(!("status" in q));
  assert.equal(f.built().operation, "verify");
  assert.equal(f.built().args.expectedRecordRevision, "0");
  assert.equal(
    f.built().plaintext.evidence[0].resultCreationDigest,
    "original-result-digest",
  );
  assert.equal(f.built().plaintext.reason, decision.reason);
  assert.equal(f.counts().signatures, 0);
  await assert.rejects(f.controller.submit({ ...q }), /invalid_quote/);
  const [a, b] = await Promise.all([
    f.controller.submit(q),
    f.controller.submit(q),
  ]);
  assert.equal(a, b);
  assert.equal(f.counts().broadcasts, 1);
  f.set({ pin: "new state" });
  assert.equal(await f.controller.prepare(f.view, decision), a);
});
test("final acceptance is a separate Human decision and explicit transaction", async () => {
  const f = await fixture(true);
  await assert.rejects(
    f.controller.prepare(f.view, {
      reviewed: false,
      reason: "all files reviewed",
    }),
    /confirmation_required/,
  );
  const q = await f.controller.prepare(f.view, decision);
  assert.ok(!("status" in q));
  assert.equal(f.built().operation, "accept");
  assert.equal(f.built().args.successCriteriaConfirmed, true);
  assert.equal(f.built().plaintext.kind, "accept");
  assert.equal(f.counts().broadcasts, 0);
});
test("unknown original Human request is queried before private reads, encryption or new fees", async () => {
  const f = await fixture();
  const original = {
    status: "unknown",
    requestId: f.controller.requestId,
    digest: "original-unknown",
    journalSynced: true,
  } as const;
  f.set({ prior: original, live: false });
  assert.equal(
    await f.controller.prepare({} as HumanReviewView, {
      reviewed: false,
      reason: "",
    }),
    original,
  );
  assert.deepEqual(f.counts(), {
    encryptions: 0,
    signatures: 0,
    broadcasts: 0,
    builds: 0,
  });
});
test("Human evidence, encryption, quote and native-signature drift cannot broadcast the earlier decision", async () => {
  for (const phase of [
    "view",
    "encrypt",
    "quote",
    "native",
    "close",
  ] as const) {
    const f = await fixture();
    if (phase === "view") f.set({ pin: "changed" });
    if (phase === "encrypt")
      f.set({ encrypt: () => f.set({ pin: "changed" }) });
    if (phase === "quote") f.set({ quote: () => f.set({ pin: "changed" }) });
    if (["view", "encrypt", "quote"].includes(phase))
      await assert.rejects(
        f.controller.prepare(f.view, decision),
        /state_changed/,
      );
    else {
      const q = await f.controller.prepare(f.view, decision);
      assert.ok(!("status" in q));
      f.set({
        native: () =>
          phase === "close"
            ? f.set({ live: false })
            : f.set({ pin: "changed" }),
      });
      await assert.rejects(f.controller.submit(q));
    }
    assert.equal(f.counts().broadcasts, 0);
  }
});
test("fresh source rejects changed OKR, unmet threshold, future sample and expired measurement before fees", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.okrRecord.version = "5";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.okrRecord.metrics[0].current = "0";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.okrRecord.metrics[0].sampled_at_ms = "2001";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.authority.clockMs = 6001n;
    },
  ]) {
    const f = await fixture();
    change(f);
    (f.controller as any).source = f.originalSource;
    await assert.rejects(f.controller.prepare(f.view, decision));
    assert.deepEqual(f.counts(), {
      encryptions: 0,
      signatures: 0,
      broadcasts: 0,
      builds: 0,
    });
  }
});
