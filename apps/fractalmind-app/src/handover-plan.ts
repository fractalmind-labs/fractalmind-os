import {
  bytesToHex,
  executionBoundaryHash,
  parseNativeFileOkrPlan,
  type HandoverProposal,
} from "@fractalmind-labs/fractalmind-sdk";
import { normalizeDraft, type DraftInput } from "./okr-draft";

export class HandoverPlanError extends Error {
  constructor(
    readonly code: "invalid_spec" | "plan_mismatch" | "unsupported_constraint",
  ) {
    super(code);
  }
}
export type OkrSpecification = ReturnType<typeof normalizeDraft>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HandoverPlanError("invalid_spec");
  return value as Record<string, unknown>;
}
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : typeof v === "bigint"
        ? v.toString()
        : v,
  );
}
function decimal(value: unknown, precision: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    value.length > 20 ||
    BigInt(value) > 0xffffffffffffffffn ||
    typeof precision !== "number" ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 6
  )
    throw new HandoverPlanError("invalid_spec");
  if (!precision) return value;
  const padded = value.padStart(precision + 1, "0");
  return `${padded.slice(0, -precision)}.${padded.slice(-precision)}`;
}
/** Reuse the draft's exact normalization rather than trusting decrypted JSON.
 * Unknown fields and incompatible schema revisions require explicit migration. */
export function parseOkrSpecification(value: unknown): OkrSpecification {
  try {
    const v = object(value),
      constraints = object(v.constraints),
      budget = object(constraints.budget);
    if (
      v.schema !== "fractalmind.okr-spec.v1" ||
      budget.asset !== "TOOL_CALLS" ||
      !Array.isArray(v.krs)
    )
      throw new Error();
    const krs = v.krs.map((raw) => {
      const k = object(raw);
      if (
        typeof k.maxAgeMs !== "string" ||
        !/^[1-9][0-9]*$/.test(k.maxAgeMs) ||
        k.maxAgeMs.length > 20 ||
        BigInt(k.maxAgeMs) % 60000n !== 0n
      )
        throw new Error();
      return {
        title: k.title,
        unit: k.unit,
        precision: k.precision,
        baseline: decimal(k.baseline, k.precision),
        target: decimal(k.target, k.precision),
        weight: k.weight,
        maxAgeMinutes: (BigInt(k.maxAgeMs) / 60000n).toString(),
        verificationRule: k.verificationRule,
      };
    });
    const normalized = normalizeDraft({
      objective: v.objective,
      successCriteria: v.successCriteria,
      priority: v.priority,
      deadlineMs: v.deadlineMs,
      krs,
      allowedPaths: constraints.allowedPaths,
      prohibitedActions: constraints.prohibitedActions,
      maxCalls: budget.limit,
    } as DraftInput);
    if (canonical(normalized) !== canonical(v)) throw new Error();
    return normalized;
  } catch {
    throw new HandoverPlanError("invalid_spec");
  }
}
function within(path: string, directory: string): boolean {
  return (
    directory === "." || path === directory || path.startsWith(`${directory}/`)
  );
}
// These exact constraints are enforced by the native file profile: it exposes
// only bounded read/write/list tools and has no network, shell or delete tool.
// Unrecognized prose cannot be granted execution authority by this controller.
const excluded = new Set([
  "network.*",
  "shell.*",
  "process.*",
  "file.delete",
  "external network",
  "no shell",
  "write outside project",
  "禁止外部网络",
  "禁止执行 shell",
  "禁止写入项目外",
]);

export function validateHandoverPlan(
  rawSpec: unknown,
  rawPlan: unknown,
  proposal: HandoverProposal,
) {
  const spec = parseOkrSpecification(rawSpec);
  const plan = parseNativeFileOkrPlan(rawPlan);
  if (
    bytesToHex(executionBoundaryHash(plan.paths)) !==
      bytesToHex(executionBoundaryHash(proposal.paths)) ||
    proposal.budget_asset !== spec.constraints.budget.asset ||
    BigInt(proposal.budget_limit) > BigInt(spec.constraints.budget.limit) ||
    plan.krs.length !== spec.krs.length ||
    spec.constraints.allowedPaths.some(
      (p) => p !== "." && p.split("/").some((s) => s === "."),
    )
  )
    throw new HandoverPlanError("plan_mismatch");
  for (const action of spec.constraints.prohibitedActions) {
    if (["file.read", "file.write", "file.list"].includes(action)) {
      if (Object.hasOwn(plan.paths, action))
        throw new HandoverPlanError("plan_mismatch");
    } else if (!excluded.has(action))
      throw new HandoverPlanError("unsupported_constraint");
  }
  for (const directories of Object.values(plan.paths))
    if (
      directories.some(
        (p) => !spec.constraints.allowedPaths.some((d) => within(p, d)),
      )
    )
      throw new HandoverPlanError("plan_mismatch");
  let total = 0n;
  for (let i = 0; i < plan.krs.length; i++) {
    const kr = plan.krs[i],
      metric = spec.krs[i];
    if (
      !["files", "文件"].includes(metric.unit) ||
      metric.precision !== 0 ||
      metric.scale !== "1" ||
      metric.baseline !== "0" ||
      metric.target !== String(kr.files.length) ||
      BigInt(kr.maxCalls) > BigInt(proposal.max_calls) ||
      kr.files.some(
        (f) =>
          !["file.read", "file.write"].every((a) =>
            plan.paths[a]?.some((d) => within(f.path, d)),
          ),
      )
    )
      throw new HandoverPlanError("plan_mismatch");
    total += BigInt(kr.maxCalls);
  }
  if (total > BigInt(proposal.budget_limit))
    throw new HandoverPlanError("plan_mismatch");
  return { spec, plan };
}
