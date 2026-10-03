import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiAddress as id } from "@mysten/sui/utils";
import {
  FractalMindSDK,
  MemoryTransactionJournal,
  okrRunnerTicketName,
  type SelfPayFeeQuote,
} from "@fractalmind-labs/fractalmind-sdk";
import { NativeOkrAutonomy } from "../src/okr-autonomy";
import { OkrControl } from "../src/okr-control";
import type { ChainReadSession } from "../src/chain";
import type { NativeDeviceSigner } from "../src/native-device";
import { okrDeliveryKey } from "../src/okr-delivery-journal";
// State-machine/race fixture: source transport and native operations are
// controlled here. The separate localnet scenario proves production sources,
// OS signing, original receipts, Coordinator and envd execution.
async function fixture(t: TestContext) {
  const key = Ed25519Keypair.generate(),
    org = id("1"),
    human = id("2"),
    grant = id("3"),
    okrId = id("4");
  const okr: any = {
    id: okrId,
    org_id: org,
    owner_human: human,
    state: 1,
    version: "1",
    agreement_version: "1",
    spec_record: id("5"),
    spec_revision: "1",
    agreement_record: id("6"),
    managed_agent: id("7"),
    managed_version: "1",
    membership_id: id("8"),
    membership_version: "1",
    workspace_hash: [1],
    boundary_hash: [2],
    budget_asset: "TOOL_CALLS",
    budget_limit: "6",
    deadline_ms: String(Date.now() + 3600000),
    expires_at_ms: String(Date.now() + 3600000),
    next_kr: "0",
    metrics: [
      { current: null, verified: false },
      { current: null, verified: false },
    ],
  };
  const policy: any = {
    approval_id: id("9"),
    agreement_version: "1",
    max_calls: "3",
    nonce: [1],
  };
  const plan = {
    format: 1,
    paths: { "file.read": ["docs"], "file.write": ["docs"] },
    krs: [0, 1].map((i) => ({
      files: [{ path: `docs/${i}.md`, content: "accepted" }],
      maxCalls: "3",
    })),
  };
  const sdk = new FractalMindSDK({
    packageId: id("a"),
    client: { core: {} } as any,
  });
  sdk.okr.getOkr = async () => structuredClone(okr);
  sdk.handover.getPolicy = async () => structuredClone(policy);
  sdk.okr.getBudget = async () =>
    ({ asset: "TOOL_CALLS", spent: 0n, reserved: 0n }) as any;
  const chain = {
    sdk,
    profile: { network: "localnet", humanId: human, chainIdentifier: "test" },
  } as unknown as ChainReadSession;
  const signer = {
    device: { address: key.toSuiAddress() },
    getPublicKey: () => key.getPublicKey(),
  } as NativeDeviceSigner;
  let claims = 0,
    controls = 0,
    tickets = 0,
    deliveries = 0,
    live = true,
    controlPrior: any,
    mode = "idle";
  let onClaim = async () => {},
    onQuote = async (_q: SelfPayFeeQuote) => {};
  const deliveryJournal = {
    claim: async (_key: string) => {
      claims++;
      await onClaim();
      return true;
    },
  };
  const controller = new NativeOkrAutonomy(
    chain,
    signer,
    grant,
    org,
    okrId,
    async () => {
      throw new Error("unused native fixture");
    },
    new MemoryTransactionJournal(),
    deliveryJournal,
    { onQuote: (q) => onQuote(q) },
    fetch,
    () => {
      if (!live) throw new Error("closed");
    },
  );
  const authority = {
    humanId: human,
    actions: ["read", "operate", "approve"],
    encryptedKeys: "opaque",
    expiresAtMs: okr.expires_at_ms,
    clockMs: BigInt(Date.now()),
    authorityPin: "initial",
    authorityContextPin: "initial",
    chainIdentifier: "test",
  };
  (controller as any).verifier.verifyOrganization = async () =>
    structuredClone(authority);
  const member = {
    id: id("8"),
    org_id: org,
    version: "1",
    revoked: false,
    expires_at_ms: okr.expires_at_ms,
    host_address: id("c"),
    coordinator_binding: id("d"),
  };
  sdk.host.getMembership = async () => structuredClone(member) as any;
  sdk.host.getManagedAgent = async () =>
    ({
      id: id("7"),
      org_id: org,
      version: "1",
      revoked: false,
      control_confirmed: true,
      runtime: "bounded-process-v1",
      membership_id: member.id,
      host_address: member.host_address,
      workspace_hash: okr.workspace_hash,
    }) as any;
  sdk.host.getCoordinatorBinding = async () =>
    ({
      id: member.coordinator_binding,
      org_id: org,
      version: "1",
      revoked: false,
    }) as any;
  const quote = (requestId: string) =>
    ({
      requestId,
      sender: key.toSuiAddress(),
      gasBudget: "200000000",
      maxSuiSpend: "0",
      expiresAtMs: Date.now() + 60000,
    }) as SelfPayFeeQuote;
  t.mock.method(
    OkrControl.prototype,
    "prepare",
    async function (this: OkrControl) {
      return controlPrior ?? quote(this.requestId);
    },
  );
  t.mock.method(
    OkrControl.prototype,
    "submit",
    async function (this: OkrControl) {
      controls++;
      return {
        status: "confirmed",
        digest: "control-" + controls,
        requestId: this.requestId,
      };
    },
  );
  t.mock.method(OkrControl.prototype, "confirmed", async () => id("b"));
  const fake: any = {
    lastSubmission: undefined,
    describe: async () => ({
      okr: structuredClone(okr),
      policy: structuredClone(policy),
      plan: structuredClone(plan),
      spec: {
        objective: "Two reviewed results",
        successCriteria: "Human accepts both",
      },
    }),
    step: async (input: any) => {
      const base = { okrId, krIndex: okr.next_kr };
      if (Number(okr.next_kr) === 2)
        return { ...base, status: "awaiting_acceptance" };
      if (okr.metrics[Number(okr.next_kr)].current !== null)
        return { ...base, status: "awaiting_verification" };
      if (input.createIfMissing) {
        const requestId = okrRunnerTicketName(
          okrId,
          okr.agreement_version,
          okr.next_kr,
        );
        await (controller as any).authorizeFee(quote(requestId));
        tickets++;
        mode = "queued";
        fake.lastSubmission = {
          status: "confirmed",
          digest: "ticket-" + tickets,
          requestId,
        };
        return {
          ...base,
          status: "queued",
          executionId: id(String(20 + tickets)),
          transactionDigest: fake.lastSubmission.digest,
        };
      }
      if (input.releaseQueued) {
        assert.equal(input.expectedExecutionId, id(String(20 + tickets)));
        assert.equal(input.expectedAgreementVersion, okr.agreement_version);
        assert.equal(input.expectedKrIndex, okr.next_kr);
        deliveries++;
        mode = "idle";
        okr.metrics[Number(okr.next_kr)].current = "1";
        return {
          ...base,
          status: "awaiting_verification",
          executionId: input.expectedExecutionId,
        };
      }
      return { ...base, status: mode };
    },
  };
  (controller as any).runner = fake;
  const start = async (gasLimit = "800000000") =>
    controller.start(await controller.review(), {
      reviewed: true,
      gasLimit,
      expiresAtMs: String(Date.now() + 600000),
    });
  return {
    controller,
    okr,
    policy,
    authority,
    member,
    plan,
    start,
    stats: () => ({ claims, controls, tickets, deliveries }),
    prior: (v: any) => {
      controlPrior = v;
    },
    mode: (v: string) => {
      mode = v;
    },
    onClaim: (f: typeof onClaim) => {
      onClaim = f;
    },
    onQuote: (f: typeof onQuote) => {
      onQuote = f;
    },
    close: () => {
      live = false;
    },
  };
}
test("one confirmed session progresses each KR once and waits for separate Human verification and acceptance", async (t) => {
  const f = await fixture(t);
  await f.start();
  assert.equal(f.stats().deliveries, 0);
  const a = f.controller.heartbeat(),
    b = f.controller.heartbeat();
  assert.equal(a, b);
  assert.equal((await a).runner.status, "awaiting_verification");
  await f.controller.heartbeat();
  assert.equal(f.stats().deliveries, 1);
  f.okr.metrics[0].verified = true;
  f.authority.authorityPin = "ordinary-product-write";
  f.okr.next_kr = "1";
  f.okr.version = "4";
  assert.equal(
    (await f.controller.heartbeat()).runner.status,
    "awaiting_verification",
  );
  assert.equal(f.stats().deliveries, 2);
  f.okr.metrics[1].verified = true;
  f.okr.next_kr = "2";
  f.okr.version = "7";
  const final = await f.controller.heartbeat();
  assert.equal(final.runner.status, "awaiting_acceptance");
  assert.equal(final.active, false);
  assert.equal(final.gasCommitted, "800000000");
  assert.equal(f.okr.state, 1);
  assert.deepEqual(f.stats(), {
    claims: 2,
    controls: 2,
    tickets: 2,
    deliveries: 2,
  });
});
test("confirmation binds the complete reviewed plan and enforces lifetime and gas inputs", async (t) => {
  const f = await fixture(t),
    view = await f.controller.review();
  await assert.rejects(
    f.controller.start(view, {
      reviewed: false,
      gasLimit: "1",
      expiresAtMs: "1",
    }),
    /confirmation_required/,
  );
  view.plan.krs[0].files[0].content = "altered";
  await assert.rejects(
    f.controller.start(view, {
      reviewed: true,
      gasLimit: "800000000",
      expiresAtMs: String(Date.now() + 1000),
    }),
    /state_changed/,
  );
  const fresh = await f.controller.review();
  await assert.rejects(
    f.controller.start(fresh, {
      reviewed: true,
      gasLimit: "0",
      expiresAtMs: String(Date.now() + 1000),
    }),
    /invalid_input/,
  );
  assert.equal(f.stats().controls, 0);
});
test("a restored queued or unknown original request never becomes an automatic redelivery", async (t) => {
  const f = await fixture(t);
  f.mode("queued");
  await f.start();
  const s = await f.controller.heartbeat();
  assert.equal(s.active, false);
  assert.equal(s.runner.reason, "original_run_needs_explicit_review");
  assert.equal(f.stats().controls, 0);
  assert.equal(f.stats().deliveries, 0);
  f.mode("idle");
  f.prior({
    status: "unknown",
    requestId: "original",
    digest: "original-digest",
  });
  await f.start();
  const unknown = await f.controller.heartbeat();
  assert.equal(unknown.runner.status, "awaiting_confirmation");
  assert.equal(unknown.runner.transactionDigest, "original-digest");
  assert.equal(f.stats().controls, 0);
  assert.equal(f.stats().tickets, 0);
});
test("permission and agreement changes stop a session before new fee or delivery", async (t) => {
  const f = await fixture(t);
  await f.start();
  f.authority.authorityContextPin = "revoked";
  assert.equal((await f.controller.heartbeat()).active, false);
  assert.equal(f.stats().controls, 0);
  f.authority.authorityContextPin = "initial";
  await f.start();
  f.okr.agreement_version = "2";
  assert.equal((await f.controller.heartbeat()).active, false);
  assert.equal(f.stats().controls, 0);
});
test("session Gas includes conservative pending ceilings and cannot spend beyond them", async (t) => {
  const f = await fixture(t);
  await f.start("200000000");
  const s = await f.controller.heartbeat();
  assert.equal(s.active, false);
  assert.equal(s.runner.reason, "gas_limit");
  assert.equal(s.gasCommitted, "200000000");
  assert.equal(f.stats().controls, 1);
  assert.equal(f.stats().tickets, 0);
  assert.equal(f.stats().deliveries, 0);
});

test("Host revocation stops even a session waiting for Human verification", async (t) => {
  const f = await fixture(t);
  await f.start();
  assert.equal(
    (await f.controller.heartbeat()).runner.status,
    "awaiting_verification",
  );
  f.member.revoked = true;
  const stopped = await f.controller.heartbeat();
  assert.equal(stopped.active, false);
  assert.equal(stopped.runner.reason, "state_changed");
  assert.equal(f.stats().deliveries, 1);
  assert.equal(f.stats().controls, 1);
});
test("changed authority during fee callback blocks the original signature and broadcast", async (t) => {
  const f = await fixture(t);
  await f.start();
  f.onQuote(async () => {
    f.authority.authorityContextPin = "replacement";
  });
  assert.equal((await f.controller.heartbeat()).active, false);
  assert.equal(f.stats().controls, 0);
});
test("closing after a durable delivery claim cannot send the queued Run", async (t) => {
  const f = await fixture(t);
  await f.start();
  f.onClaim(async () => {
    f.close();
  });
  const s = await f.controller.heartbeat();
  assert.equal(s.active, false);
  assert.equal(f.stats().claims, 1);
  assert.equal(f.stats().tickets, 1);
  assert.equal(f.stats().deliveries, 0);
});
test("stopping does not erase an original reservation or silently cancel a Run", async (t) => {
  const f = await fixture(t);
  await f.start();
  f.mode("running");
  assert.equal((await f.controller.heartbeat()).active, true);
  f.controller.stop();
  await f.controller.heartbeat();
  assert.equal(f.controller.state?.active, false);
  assert.equal(f.stats().tickets, 0);
  assert.equal(f.stats().deliveries, 0);
});
test("delivery locators use complete chain/device/Run identities", () => {
  assert.notEqual(
    okrDeliveryKey("testnet", "A", id("1"), id("2")),
    okrDeliveryKey("testnet", "B", id("1"), id("2")),
  );
  assert.throws(
    () => okrDeliveryKey("localnet", "", id("1"), id("2")),
    /journal_unavailable/,
  );
});
