import test from "node:test";
import assert from "node:assert/strict";
import { DEVICE_ACTIONS } from "@fractalmind-labs/fractalmind-sdk";
import {
  AGENT_OPERATOR_MAX_DAYS,
  allowedActionLabel,
  isNearExpiry,
  isOrdinaryDevicePairing,
  operatorActions,
  operatorExpiryAt,
  parseAgentActivity,
} from "../src/agent-operators";

test("agent marked requests stay out of ordinary device pairing", () => {
  assert.equal(isOrdinaryDevicePairing(false), true);
  assert.equal(isOrdinaryDevicePairing(true), false);
});

test("operator action choices can never include approve or host management", () => {
  assert.deepEqual(operatorActions(false), ["read"]);
  assert.deepEqual(operatorActions(true), ["read", "operate"]);
  for (const actions of [operatorActions(false), operatorActions(true)]) {
    assert.equal(actions.includes("approve" as never), false);
    assert.equal(actions.includes("manage_hosts" as never), false);
  }
  assert.equal(allowedActionLabel([DEVICE_ACTIONS.read]), "read");
  assert.equal(allowedActionLabel([DEVICE_ACTIONS.read, DEVICE_ACTIONS.operate]), "read_operate");
  assert.equal(allowedActionLabel([DEVICE_ACTIONS.read, DEVICE_ACTIONS.approve]), "invalid");
});

test("operator expiry is bounded to Move's 30-day maximum", () => {
  assert.equal(operatorExpiryAt(1_000n, AGENT_OPERATOR_MAX_DAYS), 1_000n + 30n * 86_400_000n);
  assert.throws(() => operatorExpiryAt(0, 0), RangeError);
  assert.throws(() => operatorExpiryAt(0, 31), RangeError);
});

test("near expiry is strictly under three days", () => {
  const now = 1_000_000n;
  assert.equal(isNearExpiry(now + 3n * 86_400_000n - 1n, now), true);
  assert.equal(isNearExpiry(now + 3n * 86_400_000n, now), false);
  assert.equal(isNearExpiry(now - 1n, now), false);
});

test("activity parsing keeps receipt time, digest and Move function only", () => {
  assert.deepEqual(
    parseAgentActivity([
      { digest: "first", timestampMs: 10, transaction: { commands: [{ MoveCall: { module: "okr", function: "draft" } }] } },
      { digest: "second", timestampMs: 20, transaction: { commands: [{ MoveCall: { module: "identity", function: "revoke_device" } }] } },
      { digest: "bad", timestampMs: "later" },
      { timestampMs: 40 },
    ]),
    [
      { digest: "second", at: 20, function: "identity::revoke_device" },
      { digest: "first", at: 10, function: "okr::draft" },
      { digest: "bad", at: null, function: "—" },
    ],
  );
});
