import { isValidTransactionDigest } from "@mysten/sui/utils";
import { TransactionPreflightError } from "@fractalmind-labs/fractalmind-sdk";
import type { HostOperation } from "./host-admission";
import type { DeviceTransactionHistory } from "./transaction-history";

export type HostAttempt = {
  id: string;
  deviceProfile: string;
  grantId: string;
  kind: HostOperation["kind"];
};
export type HistoricalHostAttempt = {
  attempt: HostAttempt;
  digest: string;
  previousStatus: "confirmed" | "failed";
  actualGas: string;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = /^0x[0-9a-f]{64}$/;
function fail(): never {
  throw new TransactionPreflightError(
    "journal_unavailable",
    "Cannot retain the original Host transaction history.",
  );
}
function publicAttempt(value: HostAttempt): HostAttempt {
  if (
    !value ||
    !uuid.test(value.id) ||
    !id.test(value.grantId) ||
    typeof value.deviceProfile !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.deviceProfile) ||
    !["binding", "invite", "revoke-invite", "revoke-member"].includes(
      value.kind,
    )
  )
    fail();
  // Never copy an operation body, invitation code, or native key material.
  return {
    id: value.id,
    deviceProfile: value.deviceProfile,
    grantId: value.grantId,
    kind: value.kind,
  };
}
export function readHostTransactionHistory(
  store: Store,
  attemptKey: string,
): HistoricalHostAttempt[] {
  try {
    const values: unknown = JSON.parse(
      store.getItem(`${attemptKey}:history`) ?? "[]",
    );
    if (!Array.isArray(values)) fail();
    const result = values.map((value): HistoricalHostAttempt => {
      if (
        !value ||
        !isValidTransactionDigest(value.digest) ||
        !["confirmed", "failed"].includes(value.previousStatus) ||
        typeof value.actualGas !== "string" ||
        !/^-?[0-9]+$/.test(value.actualGas)
      )
        fail();
      return {
        attempt: publicAttempt(value.attempt),
        digest: value.digest,
        previousStatus: value.previousStatus,
        actualGas: value.actualGas,
      };
    });
    if (new Set(result.map((value) => value.attempt.id)).size !== result.length)
      fail();
    return result;
  } catch {
    return fail();
  }
}

/** Preserve the old public correlation before releasing the current form.
 * This local journal is not authority; every new operation gets a new UUID
 * and fresh chain checks. Its old transaction is never resubmitted here. */
export function archiveHostTransactionHistory(
  store: Store,
  attemptKey: string,
  attempt: HostAttempt,
  result: DeviceTransactionHistory,
): HistoricalHostAttempt[] {
  try {
    const selected = publicAttempt(attempt),
      terminal = result.historicalTerminal;
    if (
      !terminal ||
      result.outcome.status !== "unknown" ||
      result.outcome.requestId !== `host:${selected.id}` ||
      !isValidTransactionDigest(result.outcome.digest) ||
      !["confirmed", "failed"].includes(terminal.status) ||
      !/^-?[0-9]+$/.test(terminal.actualGas)
    )
      fail();
    const active = store.getItem(attemptKey);
    if (
      !active ||
      JSON.stringify(publicAttempt(JSON.parse(active))) !==
        JSON.stringify(selected)
    )
      fail();
    const record: HistoricalHostAttempt = {
      attempt: selected,
      digest: result.outcome.digest,
      previousStatus: terminal!.status,
      actualGas: terminal!.actualGas,
    };
    const history = readHostTransactionHistory(store, attemptKey);
    const prior = history.find((value) => value.attempt.id === selected.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(record)) fail();
    if (!prior) history.push(record);
    const serialized = JSON.stringify(history),
      historyKey = `${attemptKey}:history`;
    store.setItem(historyKey, serialized);
    if (
      store.getItem(historyKey) !== serialized ||
      store.getItem(attemptKey) !== active
    )
      fail();
    // Failure up to here leaves the current attempt intact. A failed remove
    // is likewise retriable because history is retained and deduplicated.
    store.removeItem(attemptKey);
    if (store.getItem(attemptKey) !== null) fail();
    return history;
  } catch {
    return fail();
  }
}
