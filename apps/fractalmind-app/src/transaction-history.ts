import { isValidTransactionDigest } from "@mysten/sui/utils";
import {
  gasCost,
  TransactionPreflightError,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import type { ChainReadSession } from "./chain";

const id = /^0x[0-9a-f]{64}$/;
const request =
  /^(?:agent-(?:import|rebind)|host):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class TransactionHistoryError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_source") {
    super(code);
  }
}
export type DeviceTransactionHistory = {
  sender: string;
  outcome: SelfPayTransactionOutcome;
  /** Technical journal history only; the current receipt remains unknown. */
  historicalTerminal?: {
    status: "confirmed" | "failed";
    actualGas: string;
  };
};
const include = {
  effects: true,
  objectTypes: true,
  events: true,
  balanceChanges: true,
  transaction: true,
} as const;

/** Historical correlation is public data. A revoked/recovered device needs
 * no private key to query its original digest. This path has no signer or
 * broadcast API; only the technical journal's receipt may be reconciled. */
export async function queryDeviceTransactionHistory(
  chain: ChainReadSession,
  organizationId: string,
  grantId: string,
  requestId: string,
  journal: TransactionJournal,
): Promise<DeviceTransactionHistory | undefined> {
  if (!id.test(organizationId) || !id.test(grantId) || !request.test(requestId))
    throw new TransactionHistoryError("invalid_input");
  const snapshot = await chain.human();
  const grants = snapshot.grants.value?.filter((g) => g.id === grantId);
  const grant = grants?.length === 1 ? grants[0] : undefined;
  if (
    !grant ||
    !snapshot.human.grants.includes(grant.id) ||
    grant.human_id !== chain.profile.humanId ||
    !id.test(grant.device) ||
    (grant.org_scope !== null && grant.org_scope !== organizationId)
  )
    throw new TransactionHistoryError("invalid_source");
  // Expiry, revoked and generation deliberately do not authorize anything
  // here: the historical grant supplies only its original payer address.
  const sender = grant.device;
  const namespace = JSON.stringify([
    chain.profile.network,
    snapshot.chainIdentifier,
    sender,
  ]);
  const readEntry = async () => {
    try {
      const entry = await journal.get(namespace, requestId);
      if (
        entry &&
        (entry.format !== 1 ||
          entry.namespace !== namespace ||
          entry.requestId !== requestId ||
          entry.sender !== sender ||
          !isValidTransactionDigest(entry.digest) ||
          !Number.isSafeInteger(entry.revision) ||
          entry.revision < 1 ||
          !["pending", "confirmed", "failed"].includes(entry.status))
      )
        throw new Error("Invalid journal entry");
      return entry;
    } catch (cause) {
      throw new TransactionPreflightError(
        "journal_unavailable",
        "Cannot read the original transaction journal.",
        { cause },
      );
    }
  };
  const entry = await readEntry();
  if (!entry) return undefined;
  try {
    const result = await chain.sdk.client.client.core.getTransaction({
      digest: entry.digest,
      include,
    });
    const data =
      result.$kind === "Transaction"
        ? result.Transaction
        : result.FailedTransaction;
    // Mirrors sdk/src/transaction-manager.ts queryEntry/confirm. Keep these
    // receipt and journal CAS invariants in sync, including Gas payer and cap.
    if (
      data.digest !== entry.digest ||
      data.effects?.transactionDigest !== entry.digest ||
      data.status.success !== data.effects.status.success ||
      data.transaction?.sender !== entry.sender ||
      data.transaction.gasData.owner !== entry.sender ||
      data.transaction.gasData.budget !== entry.gasBudget
    )
      throw new Error("Receipt differs from the original transaction");
    const gasUsed = data.effects.gasUsed,
      actualGas = gasCost(gasUsed);
    if (BigInt(actualGas) > BigInt(entry.gasBudget))
      throw new Error("Receipt exceeds its signed Gas budget");
    const status: "confirmed" | "failed" = data.status.success
      ? "confirmed"
      : "failed";
    const failure = data.status.success
      ? undefined
      : JSON.stringify(data.status.error);
    const next = {
      ...entry,
      revision: entry.revision + 1,
      status,
      gasUsed,
      actualGas,
      ...(failure ? { failure } : {}),
    };
    let journalSynced = false;
    try {
      journalSynced = await journal.replace(next, entry.revision);
      if (!journalSynced) {
        const current = await readEntry();
        journalSynced =
          current?.digest === entry.digest &&
          current.status === status &&
          current.actualGas === actualGas;
      }
    } catch {
      /* Keep the known chain result even if the technical cache fails. */
    }
    return {
      sender,
      outcome: {
        status,
        requestId,
        digest: entry.digest,
        gasUsed,
        actualGas,
        reason: failure,
        journalSynced,
        transaction: data,
      },
    };
  } catch (cause) {
    let historicalTerminal: DeviceTransactionHistory["historicalTerminal"];
    // A known historical terminal can coexist with an unavailable receipt.
    // A pending row, generic RPC error or inconsistent receipt is not one.
    if (
      cause &&
      typeof cause === "object" &&
      "reason" in cause &&
      cause.reason === "notFound" &&
      "digest" in cause &&
      cause.digest === entry.digest &&
      (entry.status === "confirmed" || entry.status === "failed")
    ) {
      try {
        const current = await readEntry();
        if (
          current?.digest === entry.digest &&
          current.status === entry.status &&
          current.revision >= 2 &&
          current.gasUsed &&
          current.actualGas === gasCost(current.gasUsed) &&
          /^[0-9]+$/.test(current.gasBudget) &&
          BigInt(current.actualGas) <= BigInt(current.gasBudget)
        )
          historicalTerminal = {
            status: current.status,
            actualGas: current.actualGas,
          };
      } catch {
        /* Unreadable history cannot enable an independent operation. */
      }
    }
    // RPC failure, pruned data or an inconsistent receipt is never absence.
    return {
      sender,
      ...(historicalTerminal ? { historicalTerminal } : {}),
      outcome: {
        status: "unknown",
        requestId,
        digest: entry.digest,
        reason: "original_transaction_not_confirmed",
        journalSynced: true,
      },
    };
  }
}
