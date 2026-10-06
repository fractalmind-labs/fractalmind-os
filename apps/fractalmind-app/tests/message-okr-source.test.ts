import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  normalizeSuiAddress as id,
  fromBase64,
  toBase64,
} from "@mysten/sui/utils";
import {
  directRequestHash,
  FractalMindSDK,
  MemoryTransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeDirectAgent } from "../src/direct-agent";
import { NativeDeviceSigner } from "../src/native-device";
import {
  OkrDraftCreation,
  normalizeDraft,
  type DraftInput,
} from "../src/okr-draft";
import { parseOkrSpecification } from "../src/handover-plan";
import { specificationDraft } from "../src/okr-intervention";
import {
  readMessageOkrSource,
  verifyMessageOkrSource,
  normalizeMessageOkrSource,
  MessageOkrSourceError,
} from "../src/message-okr-source";
import type { ChainReadSession } from "../src/chain";

// Controlled source/race fixture. Real message decryption and immutable Host
// receipt verification are exercised separately by the native localnet test.
function conversation() {
  const request = {
    message: "Review the plan before choosing measurable KRs",
    bounds: { paths: { "file.read": ["docs"] }, max_calls: "0" },
  };
  const view = {
    message: {
      id: id("9"),
      org_id: id("1"),
      managed_agent: id("4"),
      managed_version: "2",
      membership_id: id("5"),
      encrypted_record: id("6"),
      permission_id: id("7"),
      permission_version: "3",
      human_id: id("2"),
      writer_device: id("8"),
      created_at_ms: "1000",
      action: "ask",
      request_hash: Array.from(directRequestHash(request, "ask")),
    },
    request,
    result: {
      run: { id: id("a"), state: 2 },
      recordId: id("b"),
      response: {
        ok: true,
        result: {
          schema: "fractalmind.model-reply.v1",
          status: "answered",
          verified: false,
          reply: {
            text: "<script>Keep this as untrusted advice</script>",
            model: "synthetic-test",
            usage: { input_tokens: 3, output_tokens: 2 },
          },
        },
      },
    },
  };
  let reads = 0;
  const controller = {
    organizationId: id("1"),
    managedAgentId: id("4"),
    chain: {
      profile: { network: "localnet" },
      checkNetwork: async () => "testchain",
    },
    message: async (messageId: string) => {
      assert.equal(messageId, view.message.id);
      reads++;
      return structuredClone(view);
    },
  } as unknown as NativeDirectAgent;
  return { controller, view, reads: () => reads };
}
const draft = (): DraftInput => ({
  objective: "Review and deliver the approved document",
  successCriteria: "Human independently accepts the original file",
  priority: 1,
  deadlineMs: String(Date.now() + 3600000),
  allowedPaths: ["docs"],
  prohibitedActions: ["network.*", "shell.*"],
  maxCalls: "3",
  krs: [
    {
      title: "Approved result",
      unit: "files",
      precision: 0,
      baseline: "0",
      target: "1",
      weight: "1",
      maxAgeMinutes: "5",
      verificationRule: "Review the actual file and hash",
    },
  ],
});
test("conversion retains exact original request, model advice and immutable references through spec/editor parsing", async () => {
  const f = conversation(),
    source = await readMessageOkrSource(f.controller, id("9"));
  assert.equal(source.reply?.verified, false);
  assert.equal(source.reply?.runId, id("a"));
  assert.deepEqual(source.request, f.view.request);
  const spec = normalizeDraft({ ...draft(), source });
  assert.deepEqual(parseOkrSpecification(spec), spec);
  assert.deepEqual(normalizeDraft(specificationDraft(spec)), spec);
  f.view.request.message = "Different later input";
  assert.notEqual(source.request.message, f.view.request.message);
  assert.equal(spec.constraints.budget.limit, "3");
  assert.equal(spec.source!.request.bounds.max_calls, "0");
});
test("forged context, another organization/instance, reply substitutions and self-verified advice cannot become provenance", async () => {
  const f = conversation(),
    source = await readMessageOkrSource(f.controller, id("9"));
  for (const mutate of [
    (v: typeof source) => {
      v.organizationId = id("c");
    },
    (v: typeof source) => {
      v.managedAgentId = id("c");
    },
    (v: typeof source) => {
      v.request.message = "Forged input";
      v.requestHash = Buffer.from(
        directRequestHash(v.request, v.action),
      ).toString("hex");
    },
    (v: typeof source) => {
      v.reply!.text = "Forged model answer";
    },
    (v: typeof source) => {
      v.reply!.recordId = id("c");
    },
    (v: typeof source) => {
      v.permissionVersion = "4";
    },
  ]) {
    const forged = structuredClone(source);
    mutate(forged);
    await assert.rejects(
      verifyMessageOkrSource(f.controller, forged),
      MessageOkrSourceError,
    );
  }
  assert.throws(
    () =>
      normalizeMessageOkrSource({
        ...source,
        reply: { ...source.reply!, verified: true },
      } as any),
    MessageOkrSourceError,
  );
  assert.throws(
    () =>
      normalizeMessageOkrSource({ ...source, executionApproved: true } as any),
    MessageOkrSourceError,
  );
  await verifyMessageOkrSource(f.controller, source);
  const beforeReply = structuredClone(source);
  delete beforeReply.reply;
  await verifyMessageOkrSource(f.controller, beforeReply);
  assert.equal(beforeReply.reply, undefined);
});

async function creationFixture() {
  const f = conversation(),
    source = await readMessageOkrSource(f.controller, id("9"));
  const key = Ed25519Keypair.generate();
  let signs = 0,
    broadcasts = 0,
    encryptions = 0,
    onNative = () => {},
    onQuote = () => {},
    live = true;
  const assertLive = () => {
    if (!live) throw new Error("closed source draft");
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
    const bytes = new Uint8Array(40);
    bytes.set(new TextEncoder().encode("FME1"));
    return toBase64(bytes);
  };
  const signer = await NativeDeviceSigner.load(native, "test-message-okr");
  const sdk = new FractalMindSDK({
    packageId: id("c"),
    okrPackageId: id("d"),
    client: { core: {} } as any,
  });
  const chain = {
    sdk,
    profile: { network: "localnet", humanId: id("2") },
    checkNetwork: async () => "testchain",
  } as unknown as ChainReadSession;
  (sdk.productRecord as any).listCurrent = async () => ({ keyVersion: "1" });
  const controller = new OkrDraftCreation(
    chain,
    signer,
    id("3"),
    id("1"),
    "12345678-1234-1234-1234-123456789abc",
    native,
    new MemoryTransactionJournal(),
    assertLive,
  );
  (controller as any).exists = async () => false;
  (controller as any).verifier.verifyOrganization = async () => ({
    authorityPin: "initial",
    encryptedKeys: { fixture: true },
    clockMs: BigInt(Date.now()),
  });
  (controller as any).verifySource = async (s: typeof source) => {
    assertLive();
    await verifyMessageOkrSource(f.controller, s);
    assertLive();
  };
  const sign = (controller as any).manager.options.signer.signTransaction;
  (controller as any).manager = {
    query: async () => undefined,
    prepare: async (input: any) => {
      onQuote();
      return Object.freeze({ requestId: input.requestId });
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
    view: f.view,
    counts: () => ({ signs, broadcasts, encryptions }),
    duringNative: (fn: () => void) => {
      onNative = fn;
    },
    duringQuote: (fn: () => void) => {
      onQuote = fn;
    },
    close: () => {
      live = false;
    },
  };
}
test("source changes during encryption, quotation or native signature abort before broadcast; hidden drafts cannot sign", async (t) => {
  for (const mode of ["encrypt", "quote", "sign", "closed"] as const)
    await t.test(mode, async () => {
      const f = await creationFixture();
      const alter = () => {
        f.view.message.permission_version = "4";
      };
      if (mode === "encrypt") f.duringNative(alter);
      if (mode === "quote") f.duringQuote(alter);
      const prepare = () =>
        f.controller.prepare({ ...draft(), source: f.source });
      if (mode === "encrypt" || mode === "quote")
        await assert.rejects(prepare(), MessageOkrSourceError);
      else {
        const quote = await prepare();
        assert.ok(!("status" in quote));
        if (mode === "sign") f.duringNative(alter);
        else f.close();
        await assert.rejects(f.controller.submit(quote as any));
      }
      assert.equal(f.counts().broadcasts, 0);
    });
});
