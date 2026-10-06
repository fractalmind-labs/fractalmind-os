import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";

export type UnresolvedDirectRequest = { requestId: string; digest: string };
type Store = Pick<Storage, "getItem" | "setItem">;
const tracked = (id: string) =>
  /^direct-(?:message:[A-Za-z0-9-]+|run:0x[0-9a-f]{64}|decision:0x[0-9a-f]{64}:(?:true|false))$/.test(
    id,
  );
const invalid = () =>
  Object.assign(new Error("Original request journal unavailable"), {
    code: "journal_unavailable",
  });

/** Public local request locators, never cached authority or success. Keeping
 * these separate from the visible latest receipt prevents another preview,
 * cancellation or successful step from hiding an unresolved original request.
 * The transaction journal and Sui remain authoritative; no journal is deleted. */
export class DirectUnresolvedRequests {
  constructor(
    private readonly store: Store,
    private readonly key: string,
  ) {}
  list(): UnresolvedDirectRequest[] {
    const raw = this.store.getItem(this.key);
    if (raw === null) return [];
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw invalid();
    }
    if (
      value?.format !== 1 ||
      !Array.isArray(value.requests) ||
      value.requests.length > 64
    )
      throw invalid();
    const ids = new Set<string>();
    for (const row of value.requests) {
      if (
        !row ||
        typeof row.requestId !== "string" ||
        row.requestId.length > 128 ||
        !tracked(row.requestId) ||
        typeof row.digest !== "string" ||
        !row.digest ||
        row.digest.length > 128 ||
        Object.keys(row).some((k) => !["requestId", "digest"].includes(k)) ||
        ids.has(row.requestId)
      )
        throw invalid();
      ids.add(row.requestId);
    }
    return value.requests;
  }
  private write(rows: UnresolvedDirectRequest[]) {
    if (rows.length > 64) throw invalid();
    const raw = JSON.stringify({ format: 1, requests: rows });
    this.store.setItem(this.key, raw);
    if (this.store.getItem(this.key) !== raw) throw invalid();
    return rows;
  }
  record(outcome: SelfPayTransactionOutcome) {
    const rows = this.list();
    if (!tracked(outcome.requestId)) return rows;
    const original = rows.find((r) => r.requestId === outcome.requestId);
    if (original && original.digest !== outcome.digest) throw invalid();
    if (outcome.status !== "unknown")
      return original ? this.resolve(original) : rows;
    if (original) return rows;
    return this.write([
      ...rows,
      { requestId: outcome.requestId, digest: outcome.digest },
    ]);
  }
  /** Only call after a matching confirmed/failed receipt or independently
   * verified original successful Run + settled claim. Never after a timeout. */
  resolve(original: UnresolvedDirectRequest) {
    const rows = this.list(),
      current = rows.find((r) => r.requestId === original.requestId);
    if (current && current.digest !== original.digest) throw invalid();
    return current
      ? this.write(rows.filter((r) => r.requestId !== original.requestId))
      : rows;
  }
  async refresh(
    query: (
      requestId: string,
    ) => Promise<SelfPayTransactionOutcome | undefined>,
  ) {
    const outcomes = [];
    for (const row of this.list()) {
      const outcome = await query(row.requestId);
      if (
        outcome &&
        (outcome.requestId !== row.requestId || outcome.digest !== row.digest)
      )
        throw invalid();
      if (outcome) outcomes.push(outcome);
    }
    // Query failure leaves all restrictions intact. Re-read for each update so
    // another observed window's different request is retained; no atomic CAS
    // is claimed for localStorage.
    for (const outcome of outcomes) this.record(outcome);
    return this.list();
  }
}

export function hasUnresolvedDecision(
  rows: UnresolvedDirectRequest[],
  messageId: string,
) {
  return rows.some(
    (r) =>
      r.requestId === `direct-decision:${messageId}:true` ||
      r.requestId === `direct-decision:${messageId}:false`,
  );
}
