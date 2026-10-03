import type { OkrRunnerOptions, OkrRunnerSubmission } from './okr-runner.js';
import { SelfPayTransactionManager, TransactionPreflightError } from './transaction-manager.js';
import type { SelfPayFeeQuote, SelfPayTransactionOutcome } from './transaction-manager.js';
import type { U64Input } from './types.js';

export type SelfPayOkrSubmitterOptions = {
  manager: SelfPayTransactionManager;
  gasBudget: U64Input;
  /** App fee confirmation or an explicitly enabled, bounded fee policy.
   * Returning false does not sign or broadcast. Funding never implies approval. */
  approveQuote(quote: SelfPayFeeQuote): Promise<boolean>;
};
const outcome = (value: SelfPayTransactionOutcome): OkrRunnerSubmission => ({
  status: value.status === 'failed' ? 'rejected' : value.status,
  digest: value.digest, reason: value.reason,
});

/** Connect durable digest recovery and fee authorization to a runner ticket.
 * A recorded request is queried, including after restart, never rebuilt.
 * Known failures require a new explicitly authorized attempt; this adapter
 * does not reset the journal or silently retry with fresh transaction bytes. */
export function createSelfPayOkrSubmitter(options: SelfPayOkrSubmitterOptions): OkrRunnerOptions['submit'] {
  return async (transaction, { requestId }) => {
    try {
      const prior = await options.manager.query(requestId);
      if (prior) return outcome(prior);
    } catch (error) {
      // Failure to read the durable journal/network cannot establish that an
      // earlier process did not send this request.
      return { status: 'unknown', reason: error instanceof TransactionPreflightError ? error.code : 'pending_query_failed' };
    }
    let quote: SelfPayFeeQuote;
    try {
      quote = await options.manager.prepare({ requestId, transaction, gasBudget: options.gasBudget });
    } catch (error) {
      if (error instanceof TransactionPreflightError && error.code === 'already_recorded') {
        try { const prior = await options.manager.query(requestId); return prior ? outcome(prior) : { status: 'unknown', reason: 'recorded_request_not_readable' }; }
        catch { return { status: 'unknown', reason: 'pending_query_failed' }; }
      }
      return { status: 'rejected', reason: error instanceof TransactionPreflightError ? error.code : 'transaction_preflight_failed' };
    }
    try {
      if (!await options.approveQuote(quote)) return { status: 'rejected', reason: 'fee_approval_declined' };
    } catch { return { status: 'rejected', reason: 'fee_approval_unavailable' }; }
    try { return outcome(await options.manager.submit(quote)); }
    catch (error) {
      // The manager only throws before broadcast. After claiming the digest,
      // transport failures return an unknown outcome that must be queried.
      return { status: 'rejected', reason: error instanceof TransactionPreflightError ? error.code : 'transaction_submission_failed' };
    }
  };
}
