import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_LOCK_MS,
  lockAfterHidden,
  sessionStatusResult,
} from "../src/device-session";
import { NativeDeviceError } from "../src/native-device";

test("session status is validated and carries no key material", () => {
  const status = sessionStatusResult(
    { profile: "primary", unlocked: true, idleTimeoutMs: 900000, remainingMs: 899000 },
    "primary",
  );
  assert.deepEqual({ ...status }, {
    profile: "primary",
    unlocked: true,
    idleTimeoutMs: 900000,
    remainingMs: 899000,
  });
  for (const value of [
    null,
    { profile: "other", unlocked: true, idleTimeoutMs: 1, remainingMs: 1 },
    { profile: "primary", unlocked: "yes", idleTimeoutMs: 1, remainingMs: 1 },
    { profile: "primary", unlocked: true, idleTimeoutMs: -1, remainingMs: 1 },
    { profile: "primary", unlocked: true, idleTimeoutMs: 1, remainingMs: 1.5 },
  ])
    assert.throws(
      () => sessionStatusResult(value, "primary"),
      (e) => e instanceof NativeDeviceError && e.code === "invalid_response",
    );
});

test("phones lock after a minute in the background; desktops use the idle timeout", () => {
  assert.equal(lockAfterHidden(BACKGROUND_LOCK_MS - 1, true), false);
  assert.equal(lockAfterHidden(BACKGROUND_LOCK_MS, true), true);
  assert.equal(lockAfterHidden(10 * BACKGROUND_LOCK_MS, false), false);
});
