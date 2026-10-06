import test from "node:test";
import assert from "node:assert/strict";
import {
  agentImportAttemptKey,
  readAgentImportAttempt,
  saveAgentImportAttempt,
  type AgentImportAttempt,
} from "../src/agent-import-attempt";
import type { AgentImportSelection } from "../src/agent-import";
import type { ConnectionProfile } from "../src/domain";

const id = (digit: string) => `0x${digit.repeat(64)}`;
const profile = {
  network: "localnet",
  chainIdentifier: "chain-a",
  humanId: id("1"),
} as ConnectionProfile;
const org = id("2");
const target: AgentImportSelection = {
  hostAddress: id("3"),
  instanceId: `native-${"a".repeat(64)}`,
  bindingId: id("4"),
  workspaceHash: "b".repeat(64),
};
const attempt: AgentImportAttempt = {
  id: "00000000-0000-0000-0000-000000000001",
  deviceProfile: "test-device",
  grantId: id("5"),
  kind: "import",
};
function fixture() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test("legacy unknown correlation is preserved separately while a different physical instance has its own attempt", () => {
  const store = fixture(),
    legacy = agentImportAttemptKey(profile, org, null);
  store.setItem(legacy, JSON.stringify(attempt));
  const current = agentImportAttemptKey(profile, org, target);
  assert.equal(readAgentImportAttempt(store, current, target), null);
  saveAgentImportAttempt(
    store,
    current,
    { ...attempt, id: "00000000-0000-0000-0000-000000000002" },
    target,
  );
  assert.deepEqual(readAgentImportAttempt(store, legacy, null), attempt);
  assert.equal(store.getItem(legacy), JSON.stringify(attempt));
  assert.equal(
    readAgentImportAttempt(store, current, target)!.id,
    "00000000-0000-0000-0000-000000000002",
  );
});

test("Host/physical instance/network/chain/Human/organization isolate attempts but workspace and coordinator do not", () => {
  const key = agentImportAttemptKey(profile, org, target);
  for (const [p, organization, selected] of [
    [{ ...profile, network: "testnet" }, org, target],
    [{ ...profile, chainIdentifier: "another-chain" }, org, target],
    [{ ...profile, humanId: id("6") }, org, target],
    [profile, id("7"), target],
    [profile, org, { ...target, hostAddress: id("8") }],
    [profile, org, { ...target, instanceId: `native-${"c".repeat(64)}` }],
  ] as Array<[ConnectionProfile, string, AgentImportSelection]>) {
    assert.notEqual(agentImportAttemptKey(p, organization, selected), key);
  }
  const changedWorkspace = {
    ...target,
    workspaceHash: "d".repeat(64),
    bindingId: id("9"),
  };
  assert.equal(agentImportAttemptKey(profile, org, changedWorkspace), key);
  const store = fixture();
  saveAgentImportAttempt(store, key, attempt, target);
  assert.equal(
    readAgentImportAttempt(store, key, changedWorkspace)!.id,
    attempt.id,
  );
  assert.throws(() =>
    saveAgentImportAttempt(
      store,
      key,
      { ...attempt, id: "00000000-0000-0000-0000-000000000003" },
      changedWorkspace,
    ),
  );
});

test("a v2 locator cannot be spliced from another instance and malformed or unavailable storage stays closed", () => {
  const store = fixture(),
    key = agentImportAttemptKey(profile, org, target);
  saveAgentImportAttempt(store, key, attempt, target);
  const wrongTarget = { ...target, instanceId: `native-${"c".repeat(64)}` };
  assert.throws(() => readAgentImportAttempt(store, key, wrongTarget));
  store.setItem(key, JSON.stringify(attempt));
  assert.throws(() => readAgentImportAttempt(store, key, target));
  store.setItem(key, "{bad");
  assert.throws(() => readAgentImportAttempt(store, key, target));
  assert.throws(() =>
    saveAgentImportAttempt(
      { getItem: () => null, setItem: () => {} },
      key,
      attempt,
      target,
    ),
  );
  assert.throws(() =>
    saveAgentImportAttempt(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("disk full");
        },
      },
      key,
      attempt,
      target,
    ),
  );
});
