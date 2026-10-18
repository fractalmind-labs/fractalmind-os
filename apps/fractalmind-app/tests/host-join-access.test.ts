import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  HOST_JOIN_ACCESS_PREFIX,
  HOST_JOIN_GAS_BUDGET,
  encodeHostJoinAccess,
  hostJoinFingerprint,
  quickInviteWithinLimits,
  INVITE_GAS_MIST,
} from "../src/host-join-access";

const id = (b: string) => "0x" + b.repeat(32);

test("Host access string carries the public configuration and the invitation for envd join", () => {
  const prefix = `FHI1:testnet:${id("cd")}:${"5a".repeat(32)}`;
  const code = `${prefix}:${createHash("sha256").update(prefix).digest("hex").slice(0, 8)}`;
  const access = encodeHostJoinAccess(
    {
      network: "testnet",
      rpcUrl: "https://fullnode.testnet.sui.io",
      packageId: id("01"),
      okrPackageId: id("02"),
      directPackageId: id("03"),
      registryId: id("04"),
    },
    id("05"),
    "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
    code,
  );
  assert.ok(access.startsWith(HOST_JOIN_ACCESS_PREFIX));
  assert.match(
    access.slice(HOST_JOIN_ACCESS_PREFIX.length),
    /^[A-Za-z0-9_-]+$/,
  );
  const payload = JSON.parse(
    Buffer.from(
      access.slice(HOST_JOIN_ACCESS_PREFIX.length),
      "base64url",
    ).toString(),
  );
  // Field names and defaults must match the Go parser (host_join_access.go).
  assert.deepEqual(payload, {
    v: 1,
    network: "testnet",
    rpc: "https://fullnode.testnet.sui.io",
    chain_identifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
    protocol_package_id: id("01"),
    protocol_original_package_id: id("01"),
    okr_package_id: id("02"),
    okr_original_package_id: id("02"),
    direct_package_id: id("03"),
    direct_original_package_id: id("03"),
    protocol_registry_id: id("04"),
    org_id: id("05"),
    host_join_gas_budget: HOST_JOIN_GAS_BUDGET,
    invite: code,
  });
  assert.ok(access.length < 4096);
});

test("Fingerprint matches envd for the same organization and Coordinator entry", async () => {
  // Golden value shared with TestHostJoinFingerprintGolden in envd.
  assert.equal(await hostJoinFingerprint(id("05"), id("07")), "MJ3Q-SB91");
  assert.notEqual(await hostJoinFingerprint(id("05"), id("08")), "MJ3Q-SB91");
});

test("One-click invitation submits only small fees that move no more than the invitation Gas", () => {
  const gas = INVITE_GAS_MIST.toString();
  assert.equal(
    quickInviteWithinLimits({
      estimatedGas: "3000000",
      simulatedSuiSpend: gas,
    }),
    true,
  );
  assert.equal(
    quickInviteWithinLimits({
      estimatedGas: "10000001",
      simulatedSuiSpend: gas,
    }),
    false,
  );
  assert.equal(
    quickInviteWithinLimits({
      estimatedGas: "3000000",
      simulatedSuiSpend: (INVITE_GAS_MIST + 1n).toString(),
    }),
    false,
  );
  assert.equal(
    quickInviteWithinLimits({ estimatedGas: "abc", simulatedSuiSpend: gas }),
    false,
  );
});
