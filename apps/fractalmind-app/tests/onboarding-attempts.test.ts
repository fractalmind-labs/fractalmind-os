import test from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase58, toBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import {
  MemoryTransactionJournal,
  createRecoveryCode,
  recoveryKeys,
  wrapKeys,
  type SelfPayFeeQuote,
  type SelfPayTransactionData,
  type TransactionJournalEntry,
} from "@fractalmind-labs/fractalmind-sdk";
import { IdentityCreation } from "../src/onboarding";
import { NativeRecoverySigner } from "../src/native-onboarding";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";

const chainIdentifier = "creationTestChain";
const humanId = normalizeSuiAddress("0x41");
const digest = (n: number) => toBase58(new Uint8Array(32).fill(n));

async function fixture() {
  const recoveryKeysValue = recoveryKeys(createRecoveryCode("localnet"));
  const deviceKeys = Ed25519Keypair.generate();
  const describe = (keys: Ed25519Keypair, encryption: Uint8Array) => ({
    format: 1,
    profile: "test-attempt",
    address: keys.toSuiAddress(),
    signingPublicKey: keys.getPublicKey().toBase64(),
    encryptionPublicKey: toBase64(encryption),
  });
  const devicePublic = describe(deviceKeys, new Uint8Array(32).fill(8));
  const envelope = toBase64(
    await wrapKeys(
      new Uint8Array([1]),
      recoveryKeysValue.encryptionPublicKey,
      "creation-attempt-test",
    ),
  );
  const material = {
    format: 1,
    network: "localnet",
    device: devicePublic,
    recovery: describe(
      recoveryKeysValue.signer,
      recoveryKeysValue.encryptionPublicKey,
    ),
    encryptedBackup: envelope,
    encryptedDeviceKeys: envelope,
  };
  const nativeCalls: string[] = [];
  const invoke: NativeInvoke = async (command) => {
    nativeCalls.push(command);
    if (command === "fm_onboarding_public") return structuredClone(material);
    if (command === "fm_device_public") return structuredClone(devicePublic);
    throw new Error("Retry must not initialize, sign, or replace native keys");
  };
  const recovery = await NativeRecoverySigner.load(
    invoke,
    devicePublic.profile,
    "localnet",
  );
  const device = await NativeDeviceSigner.load(invoke, devicePublic.profile);
  const deployment = {
    network: "localnet" as const,
    rpcUrl: "http://127.0.0.1:29000",
    packageId: normalizeSuiAddress("0x1"),
    registryId: normalizeSuiAddress("0x2"),
    chainIdentifier,
  };
  const journal = new MemoryTransactionJournal();
  const receipts = new Map<string, SelfPayTransactionData>();
  const lookups: string[] = [];
  const prepared: string[] = [];
  const submitted: string[] = [];
  let found: Awaited<ReturnType<IdentityCreation["locate"]>> = null;
  function controller() {
    const value = new IdentityCreation(deployment, recovery, device, journal);
    value.client.core.getChainIdentifier = async () => ({ chainIdentifier });
    value.client.core.getTransaction = async ({ digest: requested }) => {
      lookups.push(requested);
      const receipt = receipts.get(requested);
      if (!receipt) throw new Error("Original receipt unavailable");
      return {
        $kind: "Transaction",
        Transaction: receipt,
      } as any;
    };
    value.locate = async () => found;
    (value as any).registry = async () => ({ id: deployment.registryId });
    value.sdk.identity.createIdentity = () => new Transaction();
    value.sdk.identity.createOrganization = () => new Transaction();
    for (const manager of [value.recoveryManager, value.deviceManager]) {
      manager.prepare = async ({ requestId }) => {
        prepared.push(requestId);
        return { requestId, digest: digest(30) } as SelfPayFeeQuote;
      };
      manager.submit = async (quote) => {
        submitted.push(quote.requestId);
        throw new Error("No broadcasts are needed to select a new attempt");
      };
    }
    return value;
  }
  async function record(
    requestId: string,
    n: number,
    stage: "identity" | "organization",
    status: "failed" | "confirmed" | "unknown" = "failed",
    journalStatus: TransactionJournalEntry["status"] = "pending",
  ) {
    const sender =
      stage === "identity"
        ? material.recovery.address
        : material.device.address;
    const namespace = JSON.stringify(["localnet", chainIdentifier, sender]);
    const entry: TransactionJournalEntry = {
      format: 1,
      namespace,
      requestId,
      revision: 1,
      digest: digest(n),
      sender,
      gasBudget: "200000000",
      maxSuiSpend: "0",
      estimatedGas: "13",
      gasReferences: [],
      addressGas: true,
      createdAtMs: 1,
      status: journalStatus,
    };
    assert.equal(await journal.claim(entry), true);
    if (status !== "unknown") {
      const success = status === "confirmed";
      receipts.set(entry.digest, {
        digest: entry.digest,
        status: {
          success,
          error: success ? undefined : { $kind: "MoveAbort" },
        },
        effects: {
          transactionDigest: entry.digest,
          status: { success },
          gasUsed: {
            computationCost: "10",
            storageCost: "4",
            storageRebate: "1",
            nonRefundableStorageFee: "0",
          },
        },
        transaction: {
          sender,
          gasData: { owner: sender, budget: entry.gasBudget },
        },
      } as unknown as SelfPayTransactionData);
    }
    return entry;
  }
  return {
    controller,
    record,
    journal,
    receipts,
    lookups,
    prepared,
    submitted,
    nativeCalls,
    setFound: (exists: boolean, organizations = false) => {
      found = exists
        ? {
            profile: { ...deployment, humanId },
            grantId: normalizeSuiAddress("0x42"),
            organizations: organizations
              ? [
                  {
                    objectId: normalizeSuiAddress("0x43"),
                    type: `${deployment.packageId}::organization::Organization`,
                    name: "Existing",
                    description: "",
                    admin: devicePublic.address,
                    isActive: true,
                    agentCount: 0n,
                    taskCount: 0n,
                    depth: 0n,
                    childOrgCount: 0n,
                    parentOrgId: null,
                  },
                ]
              : [],
          }
        : null;
    },
  };
}

test("a failed creation remains the original until explicit selection; the next quote retains keys and the original fee receipt", async () => {
  const f = await fixture(),
    c = f.controller();
  const original = await f.record(c.identityRequest, 1, "identity");
  assert.equal((await c.prepareIdentity()).requestId, original.requestId);
  assert.deepEqual(f.prepared, []);
  const next = await c.beginNewAttempt("identity", original.digest);
  assert.equal(next, `identity-retry:${original.digest}`);
  assert.deepEqual(
    f.prepared,
    [],
    "Starting an attempt is not a fee quote or submission",
  );
  assert.equal((await c.prepareIdentity()).requestId, next);
  assert.deepEqual(f.prepared, [next]);
  assert.equal(
    (await f.journal.get(original.namespace, original.requestId))?.status,
    "failed",
  );
  assert.equal(c.failedTransactions[0].digest, original.digest);
  assert.equal(c.failedTransactions[0].actualGas, "13");
  assert.deepEqual(f.nativeCalls, ["fm_onboarding_public", "fm_device_public"]);
  assert.deepEqual(f.submitted, []);
  assert.equal(
    (await f.controller().queryIdentity())?.digest,
    original.digest,
    "Reload before any submission requires a new explicit decision",
  );
});

test("pending, unavailable and successful original receipts cannot create a new attempt", async () => {
  for (const status of ["unknown", "confirmed"] as const) {
    const f = await fixture(),
      c = f.controller();
    const original = await f.record(c.identityRequest, 2, "identity", status);
    await assert.rejects(
      c.beginNewAttempt("identity", original.digest),
      /original_transaction_not_failed/,
    );
    const prior = await c.prepareIdentity();
    assert.equal("status" in prior && prior.status, status);
    assert.deepEqual(f.prepared, []);
    assert.deepEqual(f.submitted, []);
  }
  const f = await fixture(),
    c = f.controller();
  const original = await f.record(c.identityRequest, 3, "identity");
  await c.queryIdentity();
  f.receipts.delete(original.digest);
  await assert.rejects(
    c.beginNewAttempt("identity", original.digest),
    /original_transaction_not_failed/,
  );
  assert.equal(
    (await c.queryIdentity())?.status,
    "unknown",
    "A cached failed status cannot replace fresh chain confirmation",
  );
});

test("reload follows recorded retry requests and unknown latest results, without replaying earlier failed attempts", async () => {
  const f = await fixture(),
    c = f.controller();
  const original = await f.record(c.identityRequest, 4, "identity");
  const firstRetry = await c.beginNewAttempt("identity", original.digest);
  const failedRetry = await f.record(firstRetry, 5, "identity");
  assert.equal((await c.queryIdentity())?.digest, failedRetry.digest);
  await assert.rejects(
    c.beginNewAttempt("identity", original.digest),
    /creation_attempt_changed/,
  );
  const secondRetry = await c.beginNewAttempt("identity", failedRetry.digest);
  const pending = await f.record(secondRetry, 6, "identity", "unknown");
  const cold = f.controller();
  assert.equal((await cold.queryIdentity())?.digest, pending.digest);
  assert.equal((await cold.prepareIdentity()).requestId, secondRetry);
  await assert.rejects(
    cold.beginNewAttempt("identity", failedRetry.digest),
    /original_transaction_not_failed/,
  );
  assert.deepEqual(
    cold.failedTransactions.map((v) => v.digest),
    [original.digest, failedRetry.digest],
  );
  f.receipts.delete(original.digest);
  f.receipts.delete(failedRetry.digest);
  assert.equal(
    (await f.controller().queryIdentity())?.digest,
    pending.digest,
    "Pruned historical failures still locate an already-journaled pending successor",
  );
  assert.deepEqual(f.prepared, []);
  assert.deepEqual(f.submitted, []);
});

test("two windows select the same successor and converge when one records its pending transaction", async () => {
  const f = await fixture(),
    a = f.controller(),
    b = f.controller();
  const original = await f.record(a.identityRequest, 7, "identity");
  const next = await a.beginNewAttempt("identity", original.digest);
  assert.equal(await b.beginNewAttempt("identity", original.digest), next);
  const pending = await f.record(next, 8, "identity", "unknown");
  assert.equal((await b.prepareIdentity()).requestId, pending.requestId);
  assert.equal((await b.queryIdentity())?.status, "unknown");
  assert.deepEqual(f.prepared, []);
});

test("organization retry preserves the confirmed Human stage and rejects stale-stage or retired quotes", async () => {
  const f = await fixture(),
    c = f.controller();
  f.setFound(true);
  const human = await f.record(c.identityRequest, 9, "identity", "confirmed");
  const org = await f.record(
    c.organizationRequest(humanId),
    10,
    "organization",
  );
  const next = await c.beginNewAttempt("organization", org.digest);
  assert.equal((await c.prepareOrganization("New name")).requestId, next);
  assert.equal((await c.queryIdentity())?.digest, human.digest);
  await assert.rejects(
    c.beginNewAttempt("identity", human.digest),
    /creation_already_exists/,
  );
  await assert.rejects(
    c.submitOrganization({ requestId: org.requestId } as SelfPayFeeQuote),
    /Wrong organization quote/,
  );
  assert.deepEqual(f.submitted, []);
  f.setFound(true, true);
  await assert.rejects(
    c.beginNewAttempt("organization", org.digest),
    /creation_already_exists/,
  );
  await assert.rejects(
    c.prepareOrganization("Another"),
    /Organization already exists/,
  );
  assert.deepEqual(f.nativeCalls, ["fm_onboarding_public", "fm_device_public"]);
});

test("identity success discovered after retry selection prevents another identity quote", async () => {
  const f = await fixture(),
    c = f.controller();
  const original = await f.record(c.identityRequest, 11, "identity");
  await c.beginNewAttempt("identity", original.digest);
  f.setFound(true);
  await assert.rejects(c.prepareIdentity(), /Identity already exists/);
  await assert.rejects(
    c.submitIdentity({ requestId: original.requestId } as SelfPayFeeQuote),
    /Wrong creation quote/,
  );
  assert.deepEqual(f.prepared, []);
  assert.deepEqual(f.submitted, []);
});

test("failure receipt persistence is required before another attempt can be selected", async () => {
  const f = await fixture(),
    c = f.controller();
  const original = await f.record(c.identityRequest, 12, "identity");
  f.journal.replace = async () => false;
  assert.equal((await c.queryIdentity())?.journalSynced, false);
  await assert.rejects(
    c.beginNewAttempt("identity", original.digest),
    /Keep the failed original receipt/,
  );
  assert.deepEqual(f.prepared, []);
  assert.equal(
    (await f.journal.get(original.namespace, original.requestId))?.digest,
    original.digest,
  );
});
