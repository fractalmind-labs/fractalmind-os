import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveHostTransactionHistory,
  readHostTransactionHistory,
  type HostAttempt,
} from "../src/host-transaction-history";
import type { DeviceTransactionHistory } from "../src/transaction-history";

const key = "host-attempt:test-scope";
const attempt: HostAttempt = {
  id: "00000000-0000-0000-0000-000000000001",
  deviceProfile: "previous-device",
  grantId: `0x${"1".repeat(64)}`,
  kind: "invite",
};
const result: DeviceTransactionHistory = {
  sender: `0x${"2".repeat(64)}`,
  outcome: {
    status: "unknown",
    requestId: `host:${attempt.id}`,
    digest: "11111111111111111111111111111111",
    journalSynced: true,
  },
  historicalTerminal: { status: "confirmed", actualGas: "100" },
};
function fixture() {
  const values = new Map<string, string>([[key, JSON.stringify(attempt)]]);
  const writes: string[] = [];
  const store = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      writes.push(`set:${name}`);
      values.set(name, value);
    },
    removeItem: (name: string) => {
      writes.push(`remove:${name}`);
      values.delete(name);
    },
  };
  return { values, writes, store };
}

test("an explicit independent Host operation retains original public history before clearing the current form", () => {
  const f = fixture();
  const history = archiveHostTransactionHistory(f.store, key, attempt, result);
  assert.equal(f.store.getItem(key), null);
  assert.deepEqual(f.writes, [`set:${key}:history`, `remove:${key}`]);
  assert.deepEqual(readHostTransactionHistory(f.store, key), history);
  assert.deepEqual(history, [
    {
      attempt,
      digest: result.outcome.digest,
      previousStatus: "confirmed",
      actualGas: "100",
    },
  ]);
  // History is correlation only. It contains no new request, signed bytes,
  // operation body, invite material, or replay method.
  assert.deepEqual(Object.keys(history[0]).sort(), [
    "actualGas",
    "attempt",
    "digest",
    "previousStatus",
  ]);
});

test("pending/unknown-only histories and mismatched requests cannot clear an active Host attempt", () => {
  for (const mode of [
    "no-terminal",
    "known-current",
    "request-mismatch",
    "invalid-digest",
  ]) {
    const f = fixture(),
      input = structuredClone(result);
    if (mode === "no-terminal") delete input.historicalTerminal;
    if (mode === "known-current") input.outcome.status = "confirmed";
    if (mode === "request-mismatch") input.outcome.requestId = "host:other";
    if (mode === "invalid-digest") input.outcome.digest = "invalid";
    assert.throws(
      () => archiveHostTransactionHistory(f.store, key, attempt, input),
      { code: "journal_unavailable" },
    );
    assert.equal(f.store.getItem(key), JSON.stringify(attempt), mode);
    assert.deepEqual(f.writes, [], mode);
  }
});

test("failed history writes or readback retain the active attempt; failed remove retains a deduplicated history", () => {
  for (const mode of ["write", "readback", "remove", "corrupt-history"]) {
    const f = fixture();
    const store = {
      ...f.store,
      setItem: (name: string, value: string) => {
        if (mode === "write") throw new Error("Storage quota");
        f.store.setItem(name, mode === "readback" ? "[]" : value);
      },
      removeItem: (name: string) => {
        if (mode === "remove") throw new Error("Storage unavailable");
        f.store.removeItem(name);
      },
    };
    if (mode === "corrupt-history") f.values.set(`${key}:history`, "bad JSON");
    assert.throws(
      () => archiveHostTransactionHistory(store, key, attempt, result),
      { code: "journal_unavailable" },
    );
    assert.equal(f.store.getItem(key), JSON.stringify(attempt), mode);
    if (mode === "remove") {
      assert.equal(readHostTransactionHistory(f.store, key).length, 1);
      assert.equal(
        archiveHostTransactionHistory(f.store, key, attempt, result).length,
        1,
      );
      assert.equal(f.store.getItem(key), null);
    }
  }
});

test("a replaced active request or conflicting old digest is preserved and cannot be silently cleared", () => {
  const f = fixture();
  const replacement = {
    ...attempt,
    id: "00000000-0000-0000-0000-000000000002",
  };
  const store = {
    ...f.store,
    setItem: (name: string, value: string) => {
      f.store.setItem(name, value);
      f.values.set(key, JSON.stringify(replacement));
    },
  };
  assert.throws(
    () => archiveHostTransactionHistory(store, key, attempt, result),
    { code: "journal_unavailable" },
  );
  assert.equal(f.store.getItem(key), JSON.stringify(replacement));
  assert.equal(
    f.writes.some((value) => value.startsWith("remove:")),
    false,
  );
  f.values.set(key, JSON.stringify(attempt));
  const conflict = structuredClone(result);
  conflict.historicalTerminal!.status = "failed";
  assert.throws(
    () => archiveHostTransactionHistory(f.store, key, attempt, conflict),
    { code: "journal_unavailable" },
  );
  assert.equal(f.store.getItem(key), JSON.stringify(attempt));
});
