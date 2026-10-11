// App v2 (#75): notifications from chain facts only — goals started and
// achieved, KR measurements, finished Runs and imported Agents. Newest first.
import type { OrganizationSnapshot } from "../domain";

export type ActivityItem = {
  key: string;
  at: number;
  icon: string;
  zh: string;
  en: string;
  /** Route to open. */
  to: string;
};
const RUN_DONE: Record<number, [string, string, string]> = {
  2: ["check", "成功", "succeeded"],
  3: ["x", "失败", "failed"],
  4: ["help", "结果未知，需要确认", "has an unknown outcome to confirm"],
  5: ["stop", "已取消", "was cancelled"],
};

export function activity(
  snapshot: Pick<OrganizationSnapshot, "okrs" | "agents"> | null,
  title: (okrId: string) => string,
  limit = 20,
): ActivityItem[] {
  if (!snapshot) return [];
  const out: ActivityItem[] = [];
  for (const row of snapshot.okrs.value ?? []) {
    const o = row.okr,
      name = title(o.id),
      to = `okrs/${o.id}`;
    if (Number(o.activated_at_ms) > 0)
      out.push({ key: `start:${o.id}:${o.agreement_version}`, at: Number(o.activated_at_ms), icon: "play", zh: `目标开始执行：${name}`, en: `Goal started: ${name}`, to });
    if (o.state === 3 && Number(o.accepted_at_ms) > 0)
      out.push({ key: `achieved:${o.id}`, at: Number(o.accepted_at_ms), icon: "flag", zh: `目标已达成：${name}`, en: `Goal achieved: ${name}`, to });
    for (const ob of row.observations.value ?? [])
      out.push({
        key: `obs:${ob.id}`,
        at: Number(ob.recorded_at_ms),
        icon: "trend",
        zh: `${name} · KR${Number(ob.kr_index) + 1} 测得 ${ob.current}`,
        en: `${name} · KR${Number(ob.kr_index) + 1} measured ${ob.current}`,
        to,
      });
    for (const ex of row.executions.value ?? []) {
      const done = RUN_DONE[ex.run.state];
      if (done)
        out.push({
          key: `run:${ex.run.id}:${ex.run.state}`,
          at: Number(ex.run.issued_at_ms),
          icon: done[0],
          zh: `${name} · KR${Number(ex.contract.kr_index) + 1} 的执行${done[1]}`,
          en: `${name} · KR${Number(ex.contract.kr_index) + 1} run ${done[2]}`,
          to,
        });
    }
  }
  for (const a of snapshot.agents.value ?? [])
    if (!a.revoked && Number(a.imported_at_ms) > 0)
      out.push({ key: `agent:${a.id}`, at: Number(a.imported_at_ms), icon: "users", zh: "导入了一个 Agent", en: "An Agent was imported", to: "agents" });
  return out.filter((x) => Number.isFinite(x.at) && x.at > 0).sort((a, b) => b.at - a.at).slice(0, limit);
}

const SEEN_KEY = "fractalmind.v2.notifications-seen.v1";
export function seenAt(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
export function markSeen(at = Date.now()) {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    /* optional */
  }
  return at;
}
