import test from "node:test";
import assert from "node:assert/strict";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  normalizeSuiAddress as id,
  fromBase64,
  toBase64,
  toBase58,
} from "@mysten/sui/utils";
import { bcs } from "@mysten/sui/bcs";
import {
  MemoryTransactionJournal,
  signNodeCommand,
  nodeCommandIntentHash,
  type HandoverProposal,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  HandoverReview,
  type HandoverReviewInput,
} from "../src/handover-review";
import { NativeDeviceSigner } from "../src/native-device";
import type { ChainReadSession } from "../src/chain";
async function fixture() {
  const key = Ed25519Keypair.generate(),
    org = id("1"),
    human = id("2"),
    grant = id("3"),
    member = id("4"),
    binding = id("5"),
    managed = id("6"),
    okr = id("7"),
    cap = id("8"),
    pkg = id("9"),
    record = id("a");
  const proposal: HandoverProposal = {
    version: "1",
    managed_agent_id: managed,
    managed_version: "1",
    okr_id: okr,
    okr_version: "1",
    spec_revision: "1",
    workspace_hash: "aa".repeat(32),
    paths: { "file.read": ["docs"], "file.write": ["docs"] },
    budget_asset: "TOOL_CALLS",
    budget_limit: "3",
    max_calls: "3",
    nonce: "bb".repeat(32),
    expires_at_ms: Date.now() + 120000,
    review_expires_at_ms: Date.now() + 50000,
  };
  const command = await signNodeCommand(key, {
    target: {
      organizationId: org,
      nodeId: id("b"),
      agentId: "native-" + "cc".repeat(32),
    },
    action: "status",
    scope: "observation",
    capability: { id: cap, revocationVersion: 1n },
    expiresAtMs: Date.now() + 120000,
    payload: { handover_review: proposal },
  });
  const input: HandoverReviewInput = {
    command,
    membershipId: member,
    bindingId: binding,
    managedAgentId: managed,
    nativeFilePlan: {
      format: 1,
      paths: structuredClone(proposal.paths),
      krs: [
        {
          maxCalls: "3",
          files: [{ path: "docs/README.md", content: "Review" }],
        },
      ],
    },
  };
  const run = {
    id: id("c"),
    org_id: org,
    managed_agent: managed,
    membership_id: member,
    capability_id: cap,
    capability_version: "1",
    delegate: command.signer,
    command_id: command.command_id,
    nonce: command.nonce,
    idempotency_key: command.idempotency_key,
    node_id: command.target.node_id,
    agent_id: command.target.agent_id,
    human_id: human,
    grant_id: grant,
    grant_version: "1",
    budget_asset: "",
    budget_amount: "0",
    issued_at_ms: String(command.issued_at_ms),
    expires_at_ms: String(command.expires_at_ms),
    created_at_ms: "100",
    intent_hash: Array.from(nodeCommandIntentHash(command)),
    action: "status",
    scope: "observation",
    state: 0,
    stop_requested: false,
  };
  const metadata = {
    writer_device: command.signer,
    writer_human: human,
    grant_id: grant,
    grant_version: "1",
    created_at_ms: "100",
  };
  let pin = "source",
    reads = 0,
    prepares = 0,
    encrypts = 0,
    signs = 0,
    broadcasts = 0,
    submitted = false,
    native = () => {},
    signing = () => {},
    quoting = () => {},
    prior: SelfPayTransactionOutcome | undefined;
  let ticket: any = {
    schema: "fractalmind.handover-review-ticket.v1",
    specRecordId: id("d"),
    input: structuredClone(input),
  };
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
      signing();
      return key.signTransaction(fromBase64(args.bytes));
    }
    assert.equal(cmd, "fm_device_encrypt_record");
    encrypts++;
    const body = JSON.parse(args.record);
    ticket = JSON.parse(new TextDecoder().decode(fromBase64(body.plaintext)));
    native();
    const envelope = new Uint8Array(32);
    envelope.set(new TextEncoder().encode("FME1"));
    return toBase64(envelope);
  };
  const signer = await NativeDeviceSigner.load(invoke, "test-review");
  const Index = bcs.struct("RecordIndex", {
    key_version: bcs.u64(),
    records: bcs.struct("Table", { id: bcs.Address, size: bcs.u64() }),
  });
  const Pointer = bcs.struct("RecordPointer", {
    record_id: bcs.Address,
    revision: bcs.u64(),
    key_version: bcs.u64(),
  });
  const table = id("e");
  const digest = toBase58(new Uint8Array(32).fill(3));
  const provenance = {
    objectId: record,
    owner: { $kind: "Immutable" },
    type: `${pkg}::product_record::EncryptedRecord`,
    previousTransaction: digest,
  };
  const chain = {
    profile: { network: "localnet", humanId: human },
    checkNetwork: async () => "fixture",
    sdk: {
      client: {
        typesPackageId: pkg,
        okrTypesPackageId: pkg,
        client: {
          core: {
            getObject: async () => ({ object: provenance }),
            getDynamicField: async ({ parentId }: { parentId: string }) => ({
              dynamicField: {
                value:
                  parentId === org
                    ? {
                        type: `${pkg}::product_record::RecordIndex`,
                        bcs: Index.serialize({
                          key_version: "1",
                          records: { id: table, size: "1" },
                        }).toBytes(),
                      }
                    : {
                        type: `${pkg}::product_record::RecordPointer`,
                        bcs: Pointer.serialize({
                          record_id: record,
                          revision: "1",
                          key_version: "1",
                        }).toBytes(),
                      },
              },
            }),
          },
        },
      },
      productRecord: {
        getRecord: async () => metadata,
        save: ({ tx }: { tx: Transaction }) => {
          tx.moveCall({
            target: `${pkg}::product_record::save`,
            arguments: [],
          });
          return tx;
        },
      },
      nodeExecution: {
        readAgentExecutions: async () => ({ executions: [{ run }] }),
        getExecution: async () => structuredClone(run),
      },
    },
  } as unknown as ChainReadSession;
  const review = new HandoverReview(
    chain,
    signer,
    grant,
    org,
    "11111111-1111-4111-8111-111111111111",
    invoke,
    new MemoryTransactionJournal(),
  );
  const context = (review as any).context;
  (review as any).context = async () => {
    reads++;
    return {
      authority: { humanId: human, encryptedKeys: "opaque-ring" },
      okr: { spec_record: id("d") },
      plan: structuredClone(input.nativeFilePlan),
      directory: { keyVersion: "1" },
      pin,
    };
  };
  (review as any).verifier.verifyOrganization = async () => ({
    authorityPin: pin,
  });
  (review as any).records.read = async () =>
    new TextEncoder().encode(JSON.stringify(ticket));
  (review as any).results.prepare = async () => {
    prepares++;
    return { transaction: new Transaction(), assertCurrent: async () => {} };
  };
  const manager = (review as any).manager,
    guarded = manager.options.signer;
  manager.query = async () => prior;
  manager.prepare = async ({ transaction }: { transaction: Transaction }) => {
    assert.equal(transaction.getData().commands.length, 1);
    quoting();
    return { requestId: review.requestId } as SelfPayFeeQuote;
  };
  manager.submit = async () => {
    await guarded.signTransaction(new Uint8Array([1, 2]));
    broadcasts++;
    submitted = true;
    prior = {
      status: "confirmed",
      digest,
      requestId: review.requestId,
      journalSynced: true,
    };
    return prior;
  };
  return {
    review,
    input,
    run,
    metadata,
    guarded,
    chain,
    signer,
    invoke,
    org,
    grant,
    context,
    digest,
    provenance,
    mutate: (v: {
      pin?: string;
      native?: () => void;
      signing?: () => void;
      quoting?: () => void;
      prior?: SelfPayTransactionOutcome;
      ticket?: (t: any) => void;
    }) => {
      if (v.pin) pin = v.pin;
      if (v.native) native = v.native;
      if (v.signing) signing = v.signing;
      if (v.quoting) quoting = v.quoting;
      if (v.prior) prior = v.prior;
      if (v.ticket) v.ticket(ticket);
    },
    counts: () => ({ reads, prepares, encrypts, signs, broadcasts, submitted }),
    ticket: () => ticket,
  };
}
test("review quotation snapshots exact plan, requires explicit submission, coalesces one broadcast and queries original before new input", async () => {
  const f = await fixture(),
    quote = (await f.review.prepare(f.input)) as SelfPayFeeQuote;
  assert.equal(f.counts().signs, 0);
  assert.equal(f.ticket().schema, "fractalmind.handover-review-ticket.v1");
  f.input.nativeFilePlan.krs[0].files[0].content = "caller mutation";
  assert.equal(
    f.ticket().input.nativeFilePlan.krs[0].files[0].content,
    "Review",
  );
  await Promise.all([f.review.submit(quote), f.review.submit(quote)]);
  assert.equal(f.counts().broadcasts, 1);
  f.mutate({ pin: "revoked" });
  assert.equal((await f.review.prepare(f.input)).digest, f.digest);
});
test("changes during encryption/quote/signing reject stale requests; forged quotes and direct signing never broadcast", async () => {
  for (const stage of ["native", "quoting", "signing"] as const) {
    const f = await fixture();
    f.mutate({ [stage]: () => f.mutate({ pin: "changed" }) });
    if (stage === "signing") {
      const quote = (await f.review.prepare(f.input)) as SelfPayFeeQuote;
      await assert.rejects(f.review.submit(quote));
    } else await assert.rejects(f.review.prepare(f.input));
    assert.equal(f.counts().broadcasts, 0);
  }
  const f = await fixture(),
    quote = (await f.review.prepare(f.input)) as SelfPayFeeQuote;
  await assert.rejects(f.review.submit({ ...quote }), /invalid_quote/);
  await assert.rejects(
    f.guarded.signTransaction(new Uint8Array([1])),
    /invalid_quote/,
  );
});
test("fresh controller restores exact signed ticket and original Run with empty journal and makes no preparation/delivery", async () => {
  const f = await fixture(),
    restored = await f.review.restore();
  assert.equal(restored.originalOutcome, undefined);
  assert.equal(restored.run!.id, f.run.id);
  assert.deepEqual(restored.ticket!.input.command, f.input.command);
  assert.equal(f.counts().prepares, 0);
  assert.equal(restored.preparationDigest, f.digest);
  await assert.rejects(f.review.send(false), /confirmation_required/);
  assert.equal(f.counts().signs, 0);
  f.run.state = 1;
  await assert.rejects(f.review.send(true), /invalid_source/);
});
test("ticket writer, Run grant/time/target/budget or signed payload substitution cannot be restored", async () => {
  const mutations: Array<(f: Awaited<ReturnType<typeof fixture>>) => void> = [
    (f) => {
      f.metadata.writer_device = id("ff");
    },
    (f) => {
      f.run.grant_id = id("ff");
    },
    (f) => {
      f.run.grant_version = "2";
    },
    (f) => {
      f.run.created_at_ms = "101";
    },
    (f) => {
      f.run.node_id = id("ff");
    },
    (f) => {
      f.run.budget_amount = "1";
    },
    (f) =>
      f.mutate({
        ticket: (t) => {
          t.input.bindingId = "invalid-binding";
        },
      }),
    (f) => {
      f.provenance.owner.$kind = "Shared";
    },
    (f) => {
      f.provenance.objectId = id("ff");
    },
    (f) => {
      f.provenance.previousTransaction = "untrusted";
    },
    (f) =>
      f.mutate({
        prior: {
          status: "unknown",
          digest: "another-original",
          requestId: f.review.requestId,
          journalSynced: true,
        },
      }),
    (f) =>
      f.mutate({
        ticket: (t) => {
          t.input.command.payload.handover_review.budget_limit = "4";
        },
      }),
    (f) =>
      f.mutate({
        ticket: (t) => {
          t.schema = "fractalmind.handover-review-ticket.v2";
        },
      }),
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(f.review.restore());
    assert.equal(f.counts().prepares, 0);
  }
});
test("unknown preparation is returned before authority or command regeneration", async () => {
  const f = await fixture();
  f.mutate({
    prior: {
      status: "unknown",
      digest: "same-original",
      requestId: f.review.requestId,
      journalSynced: true,
    },
  });
  assert.equal((await f.review.prepare(f.input)).digest, "same-original");
  assert.equal(f.counts().reads, 0);
  assert.equal(f.counts().prepares, 0);
});
