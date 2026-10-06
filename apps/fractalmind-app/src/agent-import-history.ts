import type { TransactionJournal } from "@fractalmind-labs/fractalmind-sdk";
import { AgentImportError } from "./agent-import";
import type { AgentImportAttempt } from "./agent-import-attempt";
import type { ChainReadSession } from "./chain";
import {
  queryDeviceTransactionHistory,
  TransactionHistoryError,
} from "./transaction-history";

/** Query the old payer's original transaction after device recovery. */
export async function queryAgentImportHistory(
  chain: ChainReadSession,
  organizationId: string,
  attempt: AgentImportAttempt,
  journal: TransactionJournal,
) {
  if (!["import", "rebind"].includes(attempt.kind))
    throw new AgentImportError("invalid_selection");
  try {
    return await queryDeviceTransactionHistory(
      chain,
      organizationId,
      attempt.grantId,
      `agent-${attempt.kind}:${attempt.id}`,
      journal,
    );
  } catch (error) {
    if (error instanceof TransactionHistoryError)
      throw new AgentImportError(
        error.code === "invalid_input" ? "invalid_selection" : error.code,
      );
    throw error;
  }
}
