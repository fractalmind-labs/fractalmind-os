import assert from "node:assert/strict";
import test from "node:test";
import { revealRecoveryCode } from "../src/native-onboarding";
import { NativeDeviceError, type NativeInvoke } from "../src/native-device";

const code = `FM1:localnet:${"ab".repeat(32)}:0123abcd`;
const returning =
  (value: unknown): NativeInvoke =>
  async () =>
    value;

test("revealRecoveryCode returns a well-formed code for the requested network", async () => {
  const seen: unknown[] = [];
  const invoke: NativeInvoke = async (command, args) => {
    seen.push([command, args]);
    return code;
  };
  assert.equal(await revealRecoveryCode(invoke, "primary", "localnet"), code);
  assert.deepEqual(seen, [["fm_onboarding_reveal", { profile: "primary", network: "localnet" }]]);
});

test("revealRecoveryCode rejects malformed or cross-network codes", async () => {
  for (const value of [
    42,
    "FM1:localnet:short:0123abcd",
    `FM1:devnet:${"ab".repeat(32)}:0123abcd`,
    `FM1:localnet:${"AB".repeat(32)}:0123abcd`,
    `${code}:extra`,
  ])
    await assert.rejects(
      revealRecoveryCode(returning(value), "primary", "localnet"),
      (e) => e instanceof NativeDeviceError && e.code === "invalid_response",
    );
});

test("a locked session cannot reveal the code", async () => {
  await assert.rejects(
    revealRecoveryCode(async () => Promise.reject("Locked"), "primary", "localnet"),
    (e) => e instanceof NativeDeviceError && e.code === "locked",
  );
});
