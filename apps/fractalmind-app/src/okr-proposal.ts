/** An OKR an Agent proposes in its Home (`.fractalmind/okr-proposal.json`,
 * #75). It is only a starting point for the New OKR wizard: nothing in it is
 * submitted, and the owner reviews every field before a device signs. */
export const PROPOSAL_SCHEMA = "fractalmind.okr-proposal.v1";
export type ProposalKr = {
  title: string;
  unit: string;
  baseline: string;
  target: string;
  weight: string;
  verify: "user" | "preauthorized";
};
export type OkrProposal = {
  objective: string;
  successCriteria: string[];
  priority: 0 | 1 | 2;
  deadlineMs: string;
  krs: ProposalKr[];
  allowedPaths: string[];
  prohibitedActions: string[];
  maxCalls: string;
  /** Where the Agent took it from, e.g. its own OKR.md. */
  source: string | null;
};
export class OkrProposalError extends Error {
  constructor() {
    super("invalid_proposal");
  }
}
const str = (v: unknown, max: number) => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new OkrProposalError();
  return v.trim();
};
const list = (v: unknown, min: number, max: number, each: number) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new OkrProposalError();
  return v.map((x) => str(x, each));
};
const number = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;

export function parseOkrProposal(text: string, nowMs = Date.now()): OkrProposal {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new OkrProposalError();
  }
  if (!raw || typeof raw !== "object" || raw.schema !== PROPOSAL_SCHEMA) throw new OkrProposalError();
  const priority = raw.priority;
  if (priority !== 0 && priority !== 1 && priority !== 2) throw new OkrProposalError();
  const deadline = str(raw.deadlineMs, 20);
  if (!/^[1-9][0-9]*$/.test(deadline) || Number(deadline) <= nowMs) throw new OkrProposalError();
  if (!Array.isArray(raw.krs) || raw.krs.length < 1 || raw.krs.length > 3) throw new OkrProposalError();
  const krs = raw.krs.map((k: Record<string, unknown>) => {
    const baseline = str(k?.baseline, 28),
      target = str(k?.target, 28),
      weight = str(k?.weight ?? "1", 7);
    if (!number.test(baseline) || !number.test(target) || !/^[1-9][0-9]*$/.test(weight)) throw new OkrProposalError();
    return {
      title: str(k.title, 256),
      unit: str(k.unit ?? "-", 64),
      baseline,
      target,
      weight,
      verify: k.verify === "preauthorized" ? ("preauthorized" as const) : ("user" as const),
    };
  });
  const maxCalls = str(raw.maxCalls ?? "200", 20);
  if (!/^[1-9][0-9]*$/.test(maxCalls)) throw new OkrProposalError();
  return {
    objective: str(raw.objective, 512),
    successCriteria: list(raw.successCriteria, 1, 3, 1200),
    priority,
    deadlineMs: deadline,
    krs,
    allowedPaths: list(raw.allowedPaths ?? ["."], 1, 16, 256),
    prohibitedActions: list(raw.prohibitedActions ?? [], 0, 12, 512),
    maxCalls,
    source: typeof raw.source === "string" ? raw.source.slice(0, 512) : null,
  };
}
