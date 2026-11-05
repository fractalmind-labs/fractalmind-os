// Human-facing facts for Agent operators.  These functions deliberately do
// not talk to Sui: the reader supplies verified chain records and the UI can
// test the boundary rules without a network.
import { DEVICE_ACTIONS, type DeviceAction } from "@fractalmind-labs/fractalmind-sdk";

export const AGENT_OPERATOR_MAX_DAYS = 30;
export const AGENT_OPERATOR_EXPIRY_CHOICES = [7, 30] as const;
const DAY_MS = 86_400_000;

export type AgentOperatorAction = "read" | "operate";

/** The only action choices an Agent operator may receive. */
export function operatorActions(operate: boolean): AgentOperatorAction[] {
  return operate ? ["read", "operate"] : ["read"];
}

/** Keep the UI-side expiry bound at least as narrow as the Move invariant. */
export function operatorExpiryAt(nowMs: bigint | number, days: number): bigint {
  if (!Number.isInteger(days) || days < 1 || days > AGENT_OPERATOR_MAX_DAYS)
    throw new RangeError("Agent operator expiry must be between 1 and 30 days.");
  return BigInt(nowMs) + BigInt(days) * BigInt(DAY_MS);
}

export function isOperatorExpiryChoice(days: number): days is (typeof AGENT_OPERATOR_EXPIRY_CHOICES)[number] {
  return (AGENT_OPERATOR_EXPIRY_CHOICES as readonly number[]).includes(days);
}

/** Agent markers are not ordinary device pairing requests. */
export function isOrdinaryDevicePairing(agentMarked: boolean) {
  return !agentMarked;
}

export function isNearExpiry(expiresAtMs: bigint | string | number, nowMs: bigint | string | number) {
  const remaining = BigInt(expiresAtMs) - BigInt(nowMs);
  return remaining > 0n && remaining < 3n * BigInt(DAY_MS);
}

export function isExpiredOrRevoked(
  grant: { revoked: boolean; generation: bigint | string | number; expires_at_ms: bigint | string | number },
  humanGeneration: bigint | string | number,
  nowMs: bigint | string | number,
) {
  return grant.revoked || BigInt(grant.generation) !== BigInt(humanGeneration) || BigInt(grant.expires_at_ms) <= BigInt(nowMs);
}

export function allowedActionLabel(actions: readonly number[]): "read" | "read_operate" | "invalid" {
  const values = new Set(actions);
  if (values.size !== actions.length || !values.has(DEVICE_ACTIONS.read)) return "invalid";
  if (values.size === 1) return "read";
  return values.size === 2 && values.has(DEVICE_ACTIONS.operate) ? "read_operate" : "invalid";
}

export function defaultAgentFundingMist(network: string) {
  // This is only a form default.  A separate, explicitly quoted transfer is
  // required after the authority transaction and is disabled outside localnet.
  return network === "testnet" ? 200_000_000n : 0n;
}

type CommandLike = { MoveCall?: { module?: unknown; function?: unknown } };
type TransactionLike = {
  digest?: unknown;
  timestampMs?: unknown;
  transaction?: { commands?: unknown } | null;
};
export type AgentActivity = { digest: string; at: number | null; function: string };

export type AgentActivityKind =
  | "draft_okr"
  | "add_evidence"
  | "send_message"
  | "pause_run"
  | "request_approval"
  | "other";

/** Convert only the small, documented Agent CLI write surface into a human
 * activity label. A new or unrecognized Move call must stay visibly generic. */
export function agentActivityKind(functionName: string): AgentActivityKind {
  switch (functionName) {
    case "okr::draft":
    case "okr::create_draft":
    case "okr::create_draft_by_agent":
    case "okr::update_draft":
      return "draft_okr";
    case "evidence::create":
    case "evidence::add":
      return "add_evidence";
    case "agent::message":
    case "agent::send_message":
    case "direct_agent::send_message":
      return "send_message";
    case "node_execution::request_stop":
    case "node_execution::request_stop_with_budget":
    case "node_execution::request_stop_with_budget_v2":
    case "node_execution::request_stop_with_contract":
    case "node_execution::request_stop_with_contract_v2":
    case "okr::request_stop_v2":
      return "pause_run";
    case "approval::request":
    case "product_record::request_approval":
    case "product_record::save_agent_request":
    case "review::create_review":
      return "request_approval";
    default:
      return "other";
  }
}

/** Parse only public receipt fields; malformed items do not become activity. */
export function parseAgentActivity(rows: readonly TransactionLike[], limit = 10): AgentActivity[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Invalid activity limit.");
  const out: AgentActivity[] = [];
  for (const row of rows) {
    if (typeof row.digest !== "string" || !row.digest) continue;
    const commands = Array.isArray(row.transaction?.commands) ? row.transaction!.commands as CommandLike[] : [];
    const move = commands.find((command) => command && typeof command === "object" && command.MoveCall)?.MoveCall;
    const module = typeof move?.module === "string" ? move.module : "";
    const fn = typeof move?.function === "string" ? move.function : "";
    const at = typeof row.timestampMs === "number" && Number.isFinite(row.timestampMs) && row.timestampMs > 0
      ? row.timestampMs
      : null;
    out.push({ digest: row.digest, at, function: module && fn ? `${module}::${fn}` : "—" });
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, limit);
}

/** Narrow the SDK type at the page boundary; never construct privileged actions. */
export function asDeviceActions(operate: boolean): DeviceAction[] {
  return operatorActions(operate);
}
