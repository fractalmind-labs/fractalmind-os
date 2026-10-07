import test from "node:test";
import assert from "node:assert/strict";
import { withBuiltInUpgrade } from "../src/deployments";
import type { ConnectionProfile } from "../src/domain";

const a = (n: string) => `0x${n.repeat(64)}`;
const saved: ConnectionProfile = {
  network: "testnet",
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  packageId: a("1"),
  okrPackageId: a("2"),
  directPackageId: a("3"),
  registryId: a("4"),
  humanId: a("5"),
};
const upgraded = {
  network: "testnet" as const,
  rpcUrl: saved.rpcUrl,
  packageId: a("6"),
  originalPackageId: a("1"),
  okrPackageId: a("7"),
  originalOkrPackageId: a("2"),
  directPackageId: a("8"),
  originalDirectPackageId: a("3"),
  registryId: a("4"),
};

test("a saved profile adopts a compatible upgrade of its own packages", () => {
  const p = withBuiltInUpgrade(saved, upgraded);
  assert.equal(p.packageId, a("6"));
  assert.equal(p.originalPackageId, a("1"));
  assert.equal(p.okrPackageId, a("7"));
  assert.equal(p.originalDirectPackageId, a("3"));
  assert.equal(p.humanId, a("5"));
  // Adopting is idempotent.
  assert.deepEqual(withBuiltInUpgrade(p, upgraded), p);
});

test("another registry, network or package lineage is never adopted", () => {
  assert.equal(
    withBuiltInUpgrade(saved, { ...upgraded, registryId: a("9") }),
    saved,
  );
  assert.equal(
    withBuiltInUpgrade(saved, { ...upgraded, network: "devnet" }),
    saved,
  );
  assert.equal(
    withBuiltInUpgrade(saved, { ...upgraded, originalOkrPackageId: a("9") }),
    saved,
  );
  assert.equal(withBuiltInUpgrade(saved, null), saved);
});
