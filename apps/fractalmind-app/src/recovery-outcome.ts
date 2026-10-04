import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";

export type RecoveryReceiptState = {
  outcome: SelfPayTransactionOutcome | null;
  queryUnavailable: boolean;
};

/** A transient lookup cannot erase the real terminal receipt already received
 * by this recovery session. It supplies no authority to open an organization;
 * recovery inspection continues to verify that separately on chain. */
export function reconcileRecoveryReceipt(
  previous: SelfPayTransactionOutcome | null,
  latest: SelfPayTransactionOutcome | null,
): RecoveryReceiptState {
  const receipt = previous?.transaction;
  const retain =
    latest?.status === "unknown" &&
    previous?.digest === latest.digest &&
    previous.requestId === latest.requestId &&
    (previous.status === "confirmed" || previous.status === "failed") &&
    receipt?.digest === previous.digest &&
    receipt.effects?.transactionDigest === previous.digest &&
    receipt.status.success === (previous.status === "confirmed") &&
    receipt.effects.status.success === receipt.status.success;
  return {
    outcome: retain ? previous : latest,
    queryUnavailable: !!retain,
  };
}
