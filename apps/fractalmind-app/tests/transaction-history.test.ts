import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryTransactionJournal,
  type TransactionJournalEntry,
} from "@fractalmind-labs/fractalmind-sdk";
import { queryDeviceTransactionHistory } from "../src/transaction-history";
import type { ChainReadSession } from "../src/chain";

const id = (digit: string) => `0x${digit.repeat(64)}`;
const humanId = id("1"),
  sender = id("2"),
  organizationId = id("3"),
  grantId = id("4");
const requestId = "host:00000000-0000-0000-0000-000000000001";
const digest = "11111111111111111111111111111111";
async function fixture() {
  const namespace = JSON.stringify(["localnet", "chain-a", sender]);
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
  await journal.claim(entry);
  const grant = {
    id: grantId,
    device: sender,
    human_id: humanId,
    org_scope: organizationId,
    revoked: true,
    generation: "1",
    expires_at_ms: "1",
  };
  let queries = 0,
    failure: unknown;
  const data = {
    digest,
    status: { success: true, error: null },
    transaction: { sender, gasData: { owner: sender, budget: "200000000" } },
    effects: {
      transactionDigest: digest,
      status: { success: true },
      gasUsed: {
        computationCost: "100",
        storageCost: "0",
        storageRebate: "0",
        nonRefundableStorageFee: "0",
      },
    },
  };
  // No signer, native transport, execution API or invitation entropy exists.
  const chain = {
    profile: { network: "localnet", humanId },
    human: async () => ({
      human: { id: humanId, grants: [grantId], generation: "3" },
      grants: { value: [grant] },
      chainIdentifier: "chain-a",
    }),
    sdk: {
      client: {
        client: {
          core: {
            getTransaction: async (input: { digest: string }) => {
              queries++;
              assert.equal(input.digest, digest);
              if (failure) throw failure;
              return { $kind: "Transaction", Transaction: data };
            },
          },
        },
      },
    },
  } as unknown as ChainReadSession;
  return {
    chain,
    journal,
    entry,
    grant,
    data,
    namespace,
    queries: () => queries,
    setFailure: (value: unknown) => {
      failure = value;
    },
  };
}

test("a recovered Host manager queries the old host request without invitation secrets or native keys", async () => {
  const f = await fixture();
  const result = await queryDeviceTransactionHistory(
    f.chain,
    organizationId,
    grantId,
    requestId,
    f.journal,
  );
  assert.equal(result?.sender, sender);
  assert.equal(result?.outcome.status, "confirmed");
  assert.equal(result?.outcome.requestId, requestId);
  assert.equal(result?.outcome.digest, digest);
  assert.equal(result?.outcome.actualGas, "100");
  assert.equal(result?.outcome.journalSynced, true);
  assert.equal(f.queries(), 1);
  assert.equal("code" in result!, false);
});

test("Host and Agent request namespaces stay separate and malformed public locators do not query", async () => {
  const f = await fixture();
  assert.equal(
    await queryDeviceTransactionHistory(
      f.chain,
      organizationId,
      grantId,
      requestId.replace("host:", "agent-import:"),
      f.journal,
    ),
    undefined,
  );
  for (const bad of [
    "host:wrong",
    "other:00000000-0000-0000-0000-000000000001",
    "host:",
  ])
    await assert.rejects(
      queryDeviceTransactionHistory(
        f.chain,
        organizationId,
        grantId,
        bad,
        f.journal,
      ),
      { code: "invalid_input" },
    );
  f.grant.org_scope = id("5");
  await assert.rejects(
    queryDeviceTransactionHistory(
      f.chain,
      organizationId,
      grantId,
      requestId,
      f.journal,
    ),
    { code: "invalid_source" },
  );
  assert.equal(f.queries(), 0);
});

test("an unavailable Host receipt stays unknown even when its technical journal previously confirmed it", async () => {
  const f = await fixture();
  await f.journal.replace(
    { ...f.entry, revision: 2, status: "confirmed", actualGas: "100" },
    1,
  );
  const before = await f.journal.get(f.namespace, requestId);
  f.setFailure(
    Object.assign(new Error("Transaction not found"), {
      reason: "notFound",
      digest,
    }),
  );
  const result = await queryDeviceTransactionHistory(
    f.chain,
    organizationId,
    grantId,
    requestId,
    f.journal,
  );
  assert.equal(result?.outcome.status, "unknown");
  assert.equal(result?.outcome.digest, digest);
  assert.equal(result?.outcome.transaction, undefined);
  assert.deepEqual(await f.journal.get(f.namespace, requestId), before);
  assert.equal(
    result?.historicalTerminal,
    undefined,
    "incomplete historical fees cannot release the current attempt",
  );
});

test("only exact missing receipts expose valid historical terminal metadata while current status remains unknown", async () => {
  for (const status of ["confirmed", "failed"] as const) {
    const f = await fixture();
    await f.journal.replace(
      {
        ...f.entry,
        revision: 2,
        status,
        gasUsed: f.data.effects.gasUsed,
        actualGas: "100",
      },
      1,
    );
    const before = await f.journal.get(f.namespace, requestId);
    f.setFailure(
      Object.assign(new Error("Transaction not found"), {
        reason: "notFound",
        digest,
      }),
    );
    const result = await queryDeviceTransactionHistory(
      f.chain,
      organizationId,
      grantId,
      requestId,
      f.journal,
    );
    assert.equal(result?.outcome.status, "unknown");
    assert.equal(result?.outcome.transaction, undefined);
    assert.deepEqual(result?.historicalTerminal, { status, actualGas: "100" });
    assert.deepEqual(await f.journal.get(f.namespace, requestId), before);
    assert.equal(f.queries(), 1);
  }
});

test("pending, generic errors, wrong missing digests and inconsistent receipts never enable independent Host operations", async () => {
  for (const mode of ["pending", "generic", "wrong-digest", "bad-receipt"]) {
    const f = await fixture();
    if (mode !== "pending")
      await f.journal.replace(
        {
          ...f.entry,
          revision: 2,
          status: "confirmed",
          gasUsed: f.data.effects.gasUsed,
          actualGas: "100",
        },
        1,
      );
    if (mode === "generic") f.setFailure(new Error("RPC unavailable"));
    else if (mode === "bad-receipt") f.data.transaction.sender = id("5");
    else
      f.setFailure(
        Object.assign(new Error("Not found"), {
          reason: "notFound",
          digest: mode === "wrong-digest" ? "other" : digest,
        }),
      );
    const result = await queryDeviceTransactionHistory(
      f.chain,
      organizationId,
      grantId,
      requestId,
      f.journal,
    );
    assert.equal(result?.outcome.status, "unknown", mode);
    assert.equal(result?.historicalTerminal, undefined, mode);
    assert.equal(result?.outcome.digest, digest);
  }
});

test("a changed or unreadable terminal journal on the second read cannot enable independent Host operations", async () => {
  for (const mode of [
    "pending",
    "different-digest",
    "bad-gas",
    "bad-revision",
    "unavailable",
  ]) {
    const f = await fixture();
    const terminal = {
      ...f.entry,
      revision: 2,
      status: "confirmed" as const,
      gasUsed: f.data.effects.gasUsed,
      actualGas: "100",
    };
    f.setFailure(
      Object.assign(new Error("Not found"), { reason: "notFound", digest }),
    );
    let reads = 0;
    const journal = {
      get: async () => {
        if (++reads === 1) return terminal;
        if (mode === "unavailable") throw new Error("Journal unavailable");
        return {
          ...terminal,
          ...(mode === "pending" ? { status: "pending" as const } : {}),
          ...(mode === "different-digest"
            ? { digest: "22222222222222222222222222222222" }
            : {}),
          ...(mode === "bad-gas" ? { actualGas: "99" } : {}),
          ...(mode === "bad-revision" ? { revision: 1 } : {}),
        };
      },
      claim: f.journal.claim.bind(f.journal),
      replace: f.journal.replace.bind(f.journal),
    };
    const result = await queryDeviceTransactionHistory(
      f.chain,
      organizationId,
      grantId,
      requestId,
      journal,
    );
    assert.equal(result?.outcome.status, "unknown", mode);
    assert.equal(result?.historicalTerminal, undefined, mode);
  }
});
