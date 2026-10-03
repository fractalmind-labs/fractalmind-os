import test from "node:test";
import assert from "node:assert/strict";
import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";
import {
  DirectUnresolvedRequests,
  hasUnresolvedDecision,
} from "../src/direct-unresolved";

const messageId = `0x${"1".repeat(64)}`;
function fixture() {
  const data = new Map<string, string>();
  let fail = false,
    ignore = false;
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail) throw new Error("disk full");
      if (!ignore) data.set(key, value);
    },
  };
  return {
    data,
    storage,
    store: new DirectUnresolvedRequests(storage, "scope-device"),
    fail: () => {
      fail = true;
    },
    ignore: () => {
      ignore = true;
    },
  };
}
const unknown = (requestId: string): SelfPayTransactionOutcome => ({
  status: "unknown",
  requestId,
  digest: `original-${requestId}`,
  journalSynced: true,
});

test("unknown originals survive another preview/cancellation, another successful step and cold reopen", async () => {
  const f = fixture(),
    message = unknown("direct-message:original-token"),
    run = unknown(`direct-run:${messageId}`);
  f.store.record(message);
  f.store.record(run);
  // Latest receipt/locator can change to a different fee preview, then be
  // cancelled; it cannot overwrite these independent public restrictions.
  f.storage.setItem(
    "latest",
    JSON.stringify({ requestId: `direct-revoke:${messageId}:1` }),
  );
  f.store.record({
    status: "confirmed",
    requestId: `direct-revoke:${messageId}:1`,
    digest: "other-step",
    journalSynced: true,
  });
  const reopened = new DirectUnresolvedRequests(f.storage, "scope-device"),
    queries: string[] = [];
  const rows = await reopened.refresh(async (id) => {
    queries.push(id);
    return id === message.requestId ? message : run;
  });
  assert.deepEqual(queries, [message.requestId, run.requestId]);
  assert.deepEqual(rows, [
    { requestId: message.requestId, digest: message.digest },
    { requestId: run.requestId, digest: run.digest },
  ]);
  const persisted = JSON.parse(f.data.get("scope-device")!);
  assert.ok(
    persisted.requests.every(
      (row: object) => Object.keys(row).sort().join(",") === "digest,requestId",
    ),
  );
  assert.equal(
    new DirectUnresolvedRequests(f.storage, "other-device").list().length,
    0,
  );
});

test("only matching resolved originals are removed; missing/failed queries do not erase restrictions", async () => {
  const f = fixture(),
    message = unknown("direct-message:original-token"),
    run = unknown(`direct-run:${messageId}`);
  f.store.record(message);
  f.store.record(run);
  await assert.rejects(
    f.store.refresh(async (id) => {
      if (id === message.requestId) return { ...message, status: "confirmed" };
      throw new Error("offline");
    }),
  );
  assert.equal(f.store.list().length, 2);
  assert.equal((await f.store.refresh(async () => undefined)).length, 2);
  await assert.rejects(
    f.store.refresh(async (id) => ({
      ...message,
      requestId: id,
      digest: "foreign",
      status: "confirmed",
    })),
  );
  assert.equal(f.store.list().length, 2);
  await f.store.refresh(async (id) =>
    id === message.requestId ? { ...message, status: "failed" } : run,
  );
  assert.deepEqual(f.store.list(), [
    { requestId: run.requestId, digest: run.digest },
  ]);
  // The call site must independently verify original successful Run+claim.
  f.store.resolve({ requestId: run.requestId, digest: run.digest });
  assert.deepEqual(f.store.list(), []);
  assert.equal(run.status, "unknown");
});

test("a lost approval decision blocks both answers for exactly that message", async () => {
  const f = fixture(),
    original = unknown(`direct-decision:${messageId}:true`);
  f.store.record(original);
  assert.equal(hasUnresolvedDecision(f.store.list(), messageId), true);
  assert.equal(
    hasUnresolvedDecision(f.store.list(), `0x${"2".repeat(64)}`),
    false,
  );
  // Success of a different step does not authorize the opposite decision.
  f.store.record({
    ...unknown(`direct-run:${messageId}`),
    status: "confirmed",
  });
  assert.equal(hasUnresolvedDecision(f.store.list(), messageId), true);
  await f.store.refresh(async () => ({ ...original, status: "confirmed" }));
  assert.equal(hasUnresolvedDecision(f.store.list(), messageId), false);
});

test("storage failure or malformed/tampered locators cannot silently release an original", () => {
  for (const mode of ["fail", "ignore"] as const) {
    const f = fixture(),
      original = unknown(`direct-run:${messageId}`);
    f.store.record(original);
    f[mode]();
    assert.throws(() =>
      f.store.resolve({
        requestId: original.requestId,
        digest: original.digest,
      }),
    );
    assert.equal(f.store.list().length, 1);
  }
  const f = fixture(),
    original = unknown(`direct-run:${messageId}`);
  f.store.record(original);
  assert.throws(() => f.store.record({ ...original, digest: "another" }));
  assert.throws(() =>
    f.store.resolve({ requestId: original.requestId, digest: "another" }),
  );
  f.data.set(
    "scope-device",
    '{"format":1,"requests":[{"requestId":"malformed","digest":"d"}]}',
  );
  assert.throws(() => f.store.list());
});

test("a decision preview must re-read an opposite unknown decision recorded by another window before submit", async () => {
  const f = fixture(),
    original = unknown(`direct-decision:${messageId}:true`);
  assert.equal(hasUnresolvedDecision(f.store.list(), messageId), false);
  const anotherWindow = new DirectUnresolvedRequests(f.storage, "scope-device");
  anotherWindow.record(original);
  const beforeSubmit = await f.store.refresh(async (requestId) => {
    assert.equal(requestId, original.requestId);
    return original;
  });
  assert.equal(hasUnresolvedDecision(beforeSubmit, messageId), true);
  assert.equal(original.status, "unknown");
});

test("the first unknown locator failing to persist keeps failing closed on the next preparation", () => {
  for (const mode of ["fail", "ignore"] as const) {
    const f = fixture(),
      original = unknown("direct-message:original-token");
    f[mode]();
    // The caller retains its actual receipt before attempting this write and
    // retries this record before another quote can replace the latest locator.
    assert.throws(() => f.store.record(original));
    assert.throws(() => f.store.record(original));
    assert.equal(original.status, "unknown");
  }
});
