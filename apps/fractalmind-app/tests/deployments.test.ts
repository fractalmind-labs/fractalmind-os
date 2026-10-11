import assert from "node:assert/strict";
import test from "node:test";
import { faucetHost, parseDeployment } from "../src/deployments";

const id = (c: string) => `0x${c.repeat(64)}`;
const deployment = {
  network: "localnet",
  rpcUrl: "http://127.0.0.1:29000",
  packageId: id("1"),
  okrPackageId: id("2"),
  directPackageId: id("3"),
  registryId: id("4"),
};

test("parseDeployment accepts a public deployment without a Human", () => {
  const parsed = parseDeployment(JSON.stringify(deployment));
  assert.equal(parsed?.network, "localnet");
  assert.equal(parsed?.registryId, id("4"));
  assert.equal("humanId" in (parsed ?? {}), false);
});

test("parseDeployment returns null when unset or invalid", () => {
  assert.equal(parseDeployment(undefined), null);
  assert.equal(parseDeployment("  "), null);
  assert.equal(parseDeployment("{not json"), null);
  assert.equal(parseDeployment(JSON.stringify({ ...deployment, network: "moon" })), null);
});

test("faucets exist only for local and development networks", () => {
  assert.equal(faucetHost("localnet", "http://127.0.0.1:29123/"), "http://127.0.0.1:29123");
  assert.equal(faucetHost("localnet", undefined), null);
  assert.match(faucetHost("devnet", undefined) ?? "", /^https:\/\/faucet\.devnet/);
  assert.equal(faucetHost("testnet", "http://127.0.0.1:29123"), null);
  assert.equal(faucetHost("mainnet", "http://127.0.0.1:29123"), null);
});
