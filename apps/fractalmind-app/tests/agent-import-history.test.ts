import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryTransactionJournal,
  type TransactionJournalEntry,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { queryAgentImportHistory } from "../src/agent-import-history";
import { NativeDeviceSigner } from "../src/native-device";
import type { AgentImportAttempt } from "../src/agent-import-attempt";
import type { ChainReadSession } from "../src/chain";

const id = (digit: string) => `0x${digit.repeat(64)}`;
const sender = id("1"),
  humanId = id("2"),
  organizationId = id("3"),
  grantId = id("4");
const digest = "11111111111111111111111111111111";
const namespace = JSON.stringify(["localnet", "chain-a", sender]);
const attempt: AgentImportAttempt = {
  id: "00000000-0000-0000-0000-000000000001",
  deviceProfile: "old-device-unavailable",
  grantId,
  kind: "import",
};
const requestId = `agent-import:${attempt.id}`;
async function fixture(recorded = true) {
  const journal = new MemoryTransactionJournal();
  const entry: TransactionJournalEntry = {
    format: 1,
    namespace,
    requestId,
    revision: 1,
    digest,
    sender,
    gasBudget: "200000000",
    maxSuiSpend: "0",
    estimatedGas: "100",
    gasReferences: [],
    addressGas: false,
    createdAtMs: 1,
    status: "pending",
  };
  if (recorded) await journal.claim(entry);
  const grant = {
    id: grantId,
    device: sender,
    human_id: humanId,
    org_scope: organizationId,
    revoked: true,
    generation: "1",
    expires_at_ms: "1",
  };
  const snapshot = {
    human: { id: humanId, grants: [grantId], generation: "2" },
    grants: { value: [grant] },
    chainIdentifier: "chain-a",
  };
  const data = {
    digest,
    status: { success: true, error: null as unknown },
    transaction: { sender, gasData: { owner: sender, budget: "200000000" } },
    effects: {
      transactionDigest: digest,
      status: { success: true },
      gasUsed: {
        computationCost: "100",
        storageCost: "20",
        storageRebate: "5",
        nonRefundableStorageFee: "7",
      },
    },
  };
  let queries = 0,
    signatures = 0,
    broadcasts = 0,
    offline = false,
    networkChanged = false;
  const chain = {
    profile: { network: "localnet", humanId, chainIdentifier: "chain-a" },
    human: async () => {
      if (networkChanged) throw new Error("network_changed");
      return snapshot;
    },
    sdk: {
      client: {
        client: {
          core: {
            getTransaction: async (input: { digest: string }) => {
              queries++;
              assert.equal(input.digest, digest);
              if (offline) throw new Error("notFound");
              return { $kind: "Transaction", Transaction: data };
            },
            executeTransaction: async () => {
              broadcasts++;
              throw new Error("Must not broadcast");
            },
          },
        },
      },
    },
  } as unknown as ChainReadSession;
  return {
    chain,
    journal,
    grant,
    snapshot,
    data,
    entry,
    nativeUnavailable: async () => {
      signatures++;
      throw new Error("Old device unavailable");
    },
    counts: () => ({ queries, signatures, broadcasts }),
    setOffline: () => {
      offline = true;
    },
    setNetworkChanged: () => {
      networkChanged = true;
    },
  };
}

test("a recovered device queries the revoked old device's receipt without loading its private key", async () => {
  const f = await fixture(),
    oldLoad = NativeDeviceSigner.load;
  NativeDeviceSigner.load = f.nativeUnavailable;
  try {
    const result = await queryAgentImportHistory(
      f.chain,
      organizationId,
      attempt,
      f.journal,
    );
    assert.equal(result?.sender, sender);
    assert.equal(result?.outcome.status, "confirmed");
    assert.equal(result?.outcome.digest, digest);
    assert.equal(result?.outcome.actualGas, "115");
    assert.equal(result?.outcome.journalSynced, true);
    assert.deepEqual(f.counts(), { queries: 1, signatures: 0, broadcasts: 0 });
    assert.equal(
      (await f.journal.get(namespace, requestId))?.status,
      "confirmed",
    );
  } finally {
    NativeDeviceSigner.load = oldLoad;
  }
});

test("only a verified namespace with no journal entry is unsubmitted; an unavailable journal is never absence", async () => {
  const f = await fixture(false);
  assert.equal(
    await queryAgentImportHistory(f.chain, organizationId, attempt, f.journal),
    undefined,
  );
  assert.deepEqual(f.counts(), { queries: 0, signatures: 0, broadcasts: 0 });
  await assert.rejects(
    queryAgentImportHistory(f.chain, organizationId, attempt, {
      get: async () => {
        throw new Error("IndexedDB unavailable");
      },
      claim: f.journal.claim.bind(f.journal),
      replace: f.journal.replace.bind(f.journal),
    }),
    { code: "journal_unavailable" },
  );
});

test("RPC/pruned original transactions stay unknown with their digest and unchanged journal", async () => {
  const f = await fixture();
  f.setOffline();
  for (let i = 0; i < 2; i++) {
    const result = await queryAgentImportHistory(
      f.chain,
      organizationId,
      attempt,
      f.journal,
    );
    assert.equal(result?.outcome.status, "unknown");
    assert.equal(result?.outcome.digest, digest);
    assert.equal(result?.outcome.requestId, requestId);
    assert.deepEqual(await f.journal.get(namespace, requestId), f.entry);
  }
  assert.deepEqual(f.counts(), { queries: 2, signatures: 0, broadcasts: 0 });
});

test("historical receipt validation preserves all SDK self-pay consistency and fee-cap checks", async () => {
  for (const mismatch of [
    "digest",
    "effects",
    "status",
    "sender",
    "owner",
    "budget",
    "fee-cap",
  ]) {
    const f = await fixture();
    if (mismatch === "digest") f.data.digest = "wrong";
    if (mismatch === "effects") f.data.effects.transactionDigest = "wrong";
    if (mismatch === "status") f.data.effects.status.success = false;
    if (mismatch === "sender") f.data.transaction.sender = id("5");
    if (mismatch === "owner") f.data.transaction.gasData.owner = id("5");
    if (mismatch === "budget") f.data.transaction.gasData.budget = "1";
    if (mismatch === "fee-cap")
      f.data.effects.gasUsed.computationCost = "200000001";
    const result = await queryAgentImportHistory(
      f.chain,
      organizationId,
      attempt,
      f.journal,
    );
    assert.equal(result?.outcome.status, "unknown", mismatch);
    assert.equal(result?.outcome.digest, digest);
    assert.deepEqual(await f.journal.get(namespace, requestId), f.entry);
    assert.equal(f.counts().broadcasts, 0);
  }
});

test("wrong chain or historical Human/org provenance and malformed journal cannot unlock a new operation", async () => {
  for (const mismatch of [
    "chain",
    "human",
    "organization",
    "directory",
    "namespace",
    "request",
    "sender",
    "digest",
    "revision",
    "status",
  ]) {
    const f = await fixture(false);
    if (mismatch === "chain") f.setNetworkChanged();
    if (mismatch === "human") f.grant.human_id = id("5");
    if (mismatch === "organization") f.grant.org_scope = id("5");
    if (mismatch === "directory") f.snapshot.human.grants = [];
    const malformed = { ...f.entry };
    if (mismatch === "namespace") malformed.namespace = "wrong";
    if (mismatch === "request") malformed.requestId = "other";
    if (mismatch === "sender") malformed.sender = id("5");
    if (mismatch === "digest") malformed.digest = "wrong";
    if (mismatch === "revision") malformed.revision = 0;
    if (mismatch === "status") malformed.status = "unexpected" as never;
    const journal: TransactionJournal = {
      get: async () => malformed,
      claim: f.journal.claim.bind(f.journal),
      replace: f.journal.replace.bind(f.journal),
    };
    await assert.rejects(
      queryAgentImportHistory(f.chain, organizationId, attempt, journal),
      mismatch,
    );
    assert.deepEqual(f.counts(), { queries: 0, signatures: 0, broadcasts: 0 });
  }
});

test("receipt CAS failures retain known chain outcomes without falsely claiming journal synchronization", async () => {
  for (const mode of ["throw", "lost", "already-confirmed"]) {
    const f = await fixture();
    const journal: TransactionJournal = {
      get: f.journal.get.bind(f.journal),
      claim: f.journal.claim.bind(f.journal),
      replace: async (entry, revision) => {
        if (mode === "throw") throw new Error("cache failed");
        if (mode === "already-confirmed")
          await f.journal.replace(entry, revision);
        return false;
      },
    };
    const result = await queryAgentImportHistory(
      f.chain,
      organizationId,
      attempt,
      journal,
    );
    assert.equal(result?.outcome.status, "confirmed");
    assert.equal(result?.outcome.journalSynced, mode === "already-confirmed");
    assert.equal(result?.outcome.digest, digest);
  }
});

test("a corrupt journal row after failed receipt CAS cannot be reported as synchronized", async () => {
  for (const field of ["namespace", "sender"] as const) {
    const f = await fixture();
    let reads = 0;
    const journal: TransactionJournal = {
      get: async () => {
        if (++reads === 1) return f.entry;
        return {
          ...f.entry,
          status: "confirmed",
          actualGas: "115",
          [field]: "wrong",
        };
      },
      claim: f.journal.claim.bind(f.journal),
      replace: async () => false,
    };
    const result = await queryAgentImportHistory(
      f.chain,
      organizationId,
      attempt,
      journal,
    );
    assert.equal(result?.outcome.status, "confirmed");
    assert.equal(result?.outcome.digest, digest);
    assert.equal(result?.outcome.journalSynced, false);
  }
});

test("failed original receipt remains a known failure and never resubmits", async () => {
  const f = await fixture();
  f.data.status.success = false;
  f.data.effects.status.success = false;
  f.data.status.error = { kind: "MoveAbort", message: "Original failure" };
  const result = await queryAgentImportHistory(
    f.chain,
    organizationId,
    attempt,
    f.journal,
  );
  assert.equal(result?.outcome.status, "failed");
  assert.equal(result?.outcome.digest, digest);
  assert.match(result?.outcome.reason ?? "", /Original failure/);
  assert.deepEqual(f.counts(), { queries: 1, signatures: 0, broadcasts: 0 });
});
