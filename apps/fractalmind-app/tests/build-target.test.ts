import assert from "node:assert/strict";
import test from "node:test";
import { defaultProfileFor, matchesTarget, parseBuildTarget } from "../src/build-target";

const registry = `0x${"ab".repeat(32)}`;
const testnet = parseBuildTarget(JSON.stringify({ network: "testnet", registryId: registry.toUpperCase().replace("0X", "0x") }));

test("parseBuildTarget reads network and registry", () => {
  assert.deepEqual({ ...testnet }, { network: "testnet", registryId: registry });
  assert.equal(parseBuildTarget(undefined), null);
  assert.equal(parseBuildTarget("{oops"), null);
  assert.equal(parseBuildTarget(JSON.stringify({ network: "testnet" })), null);
});

test("each network gets its own default device profile", () => {
  assert.equal(defaultProfileFor(null), "primary");
  assert.equal(defaultProfileFor({ network: "localnet", registryId: registry }), "primary");
  assert.equal(defaultProfileFor(testnet), "testnet");
});

test("records from another network or deployment do not match", () => {
  assert.equal(matchesTarget({ network: "testnet", registryId: registry }, testnet), true);
  assert.equal(matchesTarget({ network: "localnet", registryId: registry }, testnet), false);
  assert.equal(matchesTarget({ network: "testnet", registryId: `0x${"cd".repeat(32)}` }, testnet), false);
  assert.equal(matchesTarget({ network: "testnet" }, testnet, { registry: false }), true);
  assert.equal(matchesTarget(null, testnet), false);
  assert.equal(matchesTarget({ network: "localnet" }, null), true);
});
