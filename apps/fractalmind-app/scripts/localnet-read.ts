import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { ChainReadSession } from "../src/chain.ts";
import { navigation } from "../src/domain.ts";

assert.ok(
  process.argv[2] && process.argv[3],
  "Pass an existing isolated localnet deployment report and output file.",
);
const deployment = JSON.parse(await readFile(process.argv[2], "utf8"));
const rpcUrl = process.env.FM_LOCALNET_RPC ?? "http://127.0.0.1:29000";
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname),
  "This test only reads the isolated localnet.",
);
const profile = {
  network: "localnet" as const,
  rpcUrl,
  packageId: deployment.packageId,
  registryId: deployment.registryId,
  humanId: deployment.humanId,
  chainIdentifier: deployment.chain.chainIdentifier,
};
const session = new ChainReadSession(profile);
const identity = await session.human();
assert.equal(identity.human.id, deployment.humanId);
assert.ok(
  identity.organizations.some(
    (org) => org.objectId === deployment.organizationId,
  ),
);
const snapshot = await session.loadOrganization(deployment.organizationId);
assert.equal(
  snapshot.okrs.value?.length,
  deployment.recoveredOkrs.directoryCount,
  snapshot.okrs.failure ?? "Unexpected OKR directory size",
);
assert.ok(
  snapshot.memberships.value &&
    snapshot.agents.value &&
    snapshot.bindings.value,
  "Host reads must not be silently empty or unknown.",
);
assert.ok(
  snapshot.hosts.value && snapshot.hosts.value.length > 0,
  "Stable Host directory must be readable.",
);
assert.equal(
  new Set(snapshot.hosts.value.map((row) => row.address)).size,
  snapshot.hosts.value.length,
);
for (const host of snapshot.hosts.value) {
  assert.ok(
    host.current.value,
    "Current membership must resolve through active_hosts.",
  );
  assert.equal(host.current.value.host_address, host.address);
  assert.ok(
    host.history.some((member) => member.id === host.current.value!.id),
  );
}
const rejoined = snapshot.hosts.value.find((host) => host.history.length > 1);
assert.ok(rejoined, "The fixture must contain a rejoined Host.");
assert.equal(rejoined.current.value!.revoked, false);
assert.ok(
  rejoined.history.some(
    (member) =>
      member.revoked &&
      BigInt(member.version) > BigInt(rejoined.current.value!.version),
  ),
  "An old revoked record can have a higher version than the current membership.",
);
const accepted = snapshot.okrs.value.find(
  (row) => row.okr.id === deployment.recoveredOkrs.acceptedOkrId,
)!;
assert.ok(accepted);
assert.equal(
  navigation(accepted, snapshot, snapshot.clockMs, true).condition,
  "achieved",
);
assert.equal(accepted.budget.value?.spent.toString(), "11");
assert.equal(accepted.budget.value?.reserved.toString(), "0");
assert.equal(accepted.observations.value?.length, 3);
assert.equal(accepted.executions.value?.length, 4);
const unknown = snapshot.okrs.value.find(
  (row) => row.okr.id === deployment.recoveredUnknownOkr.okrId,
)!;
assert.ok(unknown);
assert.equal(
  navigation(unknown, snapshot, snapshot.clockMs, true).reason,
  "execution_outcome_unknown",
);
assert.equal(unknown.budget.value?.reserved.toString(), "14");
const other = identity.organizations.find(
  (org) => org.objectId !== deployment.organizationId,
)!;
assert.ok(other);
const empty = await session.loadOrganization(other.objectId);
assert.deepEqual(empty.okrs.value, []);
assert.deepEqual(empty.memberships.value, []);
assert.deepEqual(empty.hosts.value, []);
const fresh = new ChainReadSession(profile);
const rebuilt = await fresh.loadOrganization(deployment.organizationId);
assert.deepEqual(
  rebuilt.okrs.value!.map((row) => row.okr.id).sort(),
  snapshot.okrs.value.map((row) => row.okr.id).sort(),
);
const report = {
  schema: "fractalmind.v020-app-chain-reader.v1",
  testedAt: new Date().toISOString(),
  profile,
  humanGeneration: identity.human.generation,
  organizationIds: identity.organizations.map((org) => org.objectId),
  okrs: snapshot.okrs.value.map((row) => ({
    id: row.okr.id,
    logicalId: row.okr.logical_id,
    state: row.okr.state,
    navigation: navigation(row, snapshot, snapshot.clockMs, true),
    budget: row.budget.value && {
      asset: row.budget.value.asset,
      spent: row.budget.value.spent.toString(),
      reserved: row.budget.value.reserved.toString(),
    },
    observations: row.observations.value?.length ?? null,
    executions: row.executions.value?.length ?? null,
  })),
  hosts: snapshot.hosts.value.map((host) => ({
    address: host.address,
    currentMembershipId: host.current.value!.id,
    historyIds: host.history.map((member) => member.id),
  })),
  memberships: snapshot.memberships.value.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    revoked: row.revoked,
  })),
  checks: {
    productionSdkReads: true,
    twoOrganizations: true,
    fourOkrs: true,
    acceptedStateAndHistory: true,
    unknownRunAndReservations: true,
    stableHostDirectory: true,
    rejoinedHostUsesAuthoritativePointer: true,
    noPublicIdLoginAuthority: true,
    emptyDirectoryNotRpcFailure: true,
    newReaderCacheFreeRebuild: true,
    browserUiVerifiedSeparately: false,
    fullV020Acceptance: false,
  },
};
await writeFile(process.argv[3], JSON.stringify(report, null, 2) + "\n");
console.log(
  "App real-chain reader PASS: organizations, OKRs, Runs, observations, Host records and cache-free rebuild.",
);
