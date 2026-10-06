import test from "node:test";
import assert from "node:assert/strict";
import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";
import { reconcileRecoveryReceipt } from "../src/recovery-outcome";

function terminal(
  status: "confirmed" | "failed" = "confirmed",
): SelfPayTransactionOutcome {
  const digest = "original-digest",
    success = status === "confirmed";
  return {
    status,
    digest,
    requestId: "recover:current-device",
    journalSynced: true,
    actualGas: "20980708",
    transaction: {
      digest,
      status: { success },
      effects: { transactionDigest: digest, status: { success } },
    } as SelfPayTransactionOutcome["transaction"],
  };
}
const unknown: SelfPayTransactionOutcome = {
  status: "unknown",
  digest: "original-digest",
  requestId: "recover:current-device",
  reason: "original_transaction_not_confirmed",
  journalSynced: true,
};

test("a later unavailable recovery lookup preserves a real confirmed or failed receipt and separately marks that lookup unavailable", () => {
  for (const status of ["confirmed", "failed"] as const) {
    const previous = terminal(status);
    const state = reconcileRecoveryReceipt(previous, unknown);
    assert.equal(state.outcome, previous);
    assert.equal(state.outcome?.status, status);
    assert.equal(state.outcome?.actualGas, "20980708");
    assert.equal(state.queryUnavailable, true);
  }
});

test("a different digest or recovery request never inherits the previous transaction's terminal state", () => {
  for (const latest of [
    { ...unknown, digest: "another-digest" },
    { ...unknown, requestId: "recover:other-device" },
  ]) {
    const state = reconcileRecoveryReceipt(terminal(), latest);
    assert.equal(state.outcome, latest);
    assert.equal(state.outcome?.status, "unknown");
    assert.equal(state.queryUnavailable, false);
  }
});

test("the first unavailable recovery lookup remains unknown and cannot create a confirmed receipt", () => {
  const initial = reconcileRecoveryReceipt(null, unknown);
  assert.equal(initial.outcome, unknown);
  assert.equal(initial.queryUnavailable, false);
  assert.deepEqual(reconcileRecoveryReceipt(initial.outcome, unknown), initial);
});

test("a label or inconsistent receipt is insufficient to retain a recovery terminal state", () => {
  for (const mode of [
    "no-receipt",
    "digest",
    "effects-digest",
    "status",
    "effects-status",
  ]) {
    const previous = terminal();
    if (mode === "no-receipt") delete previous.transaction;
    if (mode === "digest") previous.transaction!.digest = "another";
    if (mode === "effects-digest")
      previous.transaction!.effects!.transactionDigest = "another";
    if (mode === "status") previous.transaction!.status.success = false;
    if (mode === "effects-status")
      previous.transaction!.effects!.status.success = false;
    assert.equal(
      reconcileRecoveryReceipt(previous, unknown).outcome,
      unknown,
      mode,
    );
    assert.equal(
      reconcileRecoveryReceipt(previous, unknown).queryUnavailable,
      false,
      mode,
    );
  }
});

test("a fresh verified receipt clears the unavailable lookup notice and a cleared session retains no old outcome", () => {
  const previous = terminal(),
    latest = terminal();
  latest.journalSynced = false;
  const unavailable = reconcileRecoveryReceipt(previous, unknown);
  assert.deepEqual(reconcileRecoveryReceipt(unavailable.outcome, latest), {
    outcome: latest,
    queryUnavailable: false,
  });
  assert.deepEqual(reconcileRecoveryReceipt(previous, null), {
    outcome: null,
    queryUnavailable: false,
  });
});
