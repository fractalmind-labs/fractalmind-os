// App v2 (#75): view facts derived from the chain snapshot, named as the
// prototype names them (conditions, lifecycle, onboarding steps). Pure
// functions over the store; nothing here authorizes an action.
import { navigation, memberStatus, type Navigation, type OkrSnapshot, type OrganizationSnapshot } from "../domain";
import { decisionFacts } from "../v2-model";
import { shortId } from "./ui";

type AppView = {
  snapshot: OrganizationSnapshot | null;
  now: bigint;
  reachable: boolean;
  okrTexts: ReadonlyMap<string, { objective?: string }>;
};

/** Prototype condition codes (core.js COND) for a chain navigation state. */
export type Cond = "on_track" | "boundary" | "blocked" | "waiting" | "unknown" | "paused" | "achieved" | "idle";
export function condOf(condition: Navigation["condition"]): Cond {
  switch (condition) {
    case "running":
    case "ready":
      return "on_track";
    case "budget":
    case "permission":
    case "expired":
      return "boundary";
    case "failed":
    case "stopped":
      return "blocked";
    case "queued":
    case "measurement":
    case "verification":
    case "acceptance":
      return "waiting";
    case "paused":
      return "paused";
    case "achieved":
      return "achieved";
    case "unknown":
      return "unknown";
    default:
      return "idle";
  }
}
export const COND: Record<Cond, [string, string, string]> = {
  on_track: ["trend", "正常推进", "On track"],
  boundary: ["alert", "临近/触及边界", "At the boundary"],
  blocked: ["block", "当前路径阻断", "Path blocked"],
  waiting: ["hourglass", "正常等待依赖", "Waiting on a dependency"],
  unknown: ["help", "状态未知", "Status unknown"],
  paused: ["pause", "已暂停", "Paused"],
  achieved: ["flag", "已抵达", "Arrived"],
  idle: ["clock", "未激活", "Not active"],
};

/** Prototype lifecycle names for the chain OKR state. */
export type Life = "DRAFT" | "ACTIVE" | "PAUSED" | "ACHIEVED" | "ARCHIVED";
export const lifeOf = (state: number): Life =>
  (["DRAFT", "ACTIVE", "PAUSED", "ACHIEVED", "ARCHIVED"] as const)[state] ?? "DRAFT";
export const LIFE: Record<Life, [string, string, string]> = {
  ACTIVE: ["info", "进行中", "Active"],
  PAUSED: ["wait", "已暂停", "Paused"],
  DRAFT: ["muted", "草稿", "Draft"],
  ACHIEVED: ["brand", "已达成", "Achieved"],
  ARCHIVED: ["muted", "已归档", "Archived"],
};

export function okrTitle(app: Pick<AppView, "okrTexts" | "snapshot">, id: string) {
  const row = app.snapshot?.okrs.value?.find((o) => o.okr.id === id);
  return app.okrTexts.get(id)?.objective ?? `OKR ${shortId(row?.okr.logical_id ?? id)}`;
}
export const activeOkrs = (app: Pick<AppView, "snapshot">) =>
  (app.snapshot?.okrs.value ?? []).filter((r) => r.okr.state === 1);

/** The goal the workbench and context bar follow: the first active one. */
export function focusOkr(app: Pick<AppView, "snapshot">, id?: string | null): OkrSnapshot | null {
  const okrs = app.snapshot?.okrs.value ?? [];
  return okrs.find((r) => r.okr.id === id) ?? activeOkrs(app)[0] ?? null;
}

export function nav(app: AppView, row: OkrSnapshot) {
  return app.snapshot ? navigation(row, app.snapshot, app.now, app.reachable) : null;
}

export function decisions(app: AppView) {
  return app.snapshot ? decisionFacts(app.snapshot, app.now, app.reachable) : { unavailable: "okrs" as const, items: [] };
}

export function orgCounts(app: AppView) {
  const hosts = app.snapshot?.hosts.value ?? [];
  return {
    decisions: decisions(app).items.length,
    hostsAttention: hosts.filter((h) => !h.current.value || memberStatus(h.current.value, app.now) !== "valid").length,
  };
}

/** “Get to your first result” (prototype onboarding), as real steps: this
 * computer as a host, an Agent, then the first OKR. */
export type Onboarding = { host: boolean; agent: boolean; okr: boolean; done: boolean };
export function onboarding(app: Pick<AppView, "snapshot" | "now">): Onboarding | null {
  const s = app.snapshot;
  if (!s?.hosts.value || !s.agents.value || !s.okrs.value) return null;
  const host = s.hosts.value.some((h) => h.current.value && memberStatus(h.current.value, app.now) === "valid");
  const agent = s.agents.value.some((a) => !a.revoked);
  const okr = s.okrs.value.length > 0;
  return { host, agent, okr, done: host && agent && okr };
}
