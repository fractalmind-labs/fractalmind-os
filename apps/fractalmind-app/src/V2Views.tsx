import type { ReactNode } from "react";
import type { OrganizationSnapshot } from "./domain";
import { decisionFacts, type TrustLevel } from "./v2-model";
import { shortId } from "./display";

type Translate = (zh: string, en: string) => string;
export function BrandMark() {
  return (
    <img className="logo" src="./favicon.svg" width="26" height="26" alt="" />
  );
}
const icons: Record<string, ReactNode> = {
  home: <path d="m3 10 9-7 9 7v10H3Zm6 10v-7h6v7" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6h.01M7 17h.01M11 6h6M11 17h6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" />
    </>
  ),
  book: (
    <>
      <path d="M12 5v16M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z" />
    </>
  ),
  shield: <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 4v4m0 4v8M12 4v10m0 4v2M20 4v2m0 4v10" />
      <circle cx="4" cy="10" r="2" />
      <circle cx="12" cy="16" r="2" />
      <circle cx="20" cy="8" r="2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5Zm-9 10 9 5 9-5M3 18l9 5 9-5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18" />
    </>
  ),
  // Shell icons, same paths as the prototype's core.js.
  folder: (
    <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  down: <path d="m6 9 6 6 6-6" />,
  right: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  refresh: (
    <>
      <path d="M20 11.5A8 8 0 0 0 6.2 6.3L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M4 12.5a8 8 0 0 0 13.8 5.2L20 15.5" />
      <path d="M20 20v-4.5h-4.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  laptop: (
    <>
      <rect x="4.5" y="5" width="15" height="10" rx="1.5" />
      <path d="M2.5 19h19" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.4h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 20.5h-4A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5h4" />
      <path d="M16 16.5l4.5-4.5L16 7.5" />
      <path d="M20.5 12H9.5" />
    </>
  ),
};
export function NavIcon({ name }: { name: string }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name] ?? icons.layers}
    </svg>
  );
}
export function TrustLadder({
  level = null,
  stale = false,
  t,
}: {
  level?: TrustLevel;
  stale?: boolean;
  t: Translate;
}) {
  const levels = ["claimed", "measured", "verified", "accepted"] as const;
  const labels = [
    ["Agent 声明", "Agent claimed"],
    ["采样测量", "Measured"],
    ["已验证", "Verified"],
    ["已验收", "Accepted"],
  ] as const;
  const active = level === null ? -1 : levels.indexOf(level);
  return (
    <div className="trust-ladder" aria-label={t("可信阶梯", "Trust ladder")}>
      <ol>
        {levels.map((id, i) => (
          <li key={id} className={active === i ? `trust-${id} active` : ""}>
            <span className="trust-dot" aria-hidden="true" />
            {t(labels[i][0], labels[i][1])}
            {active === i && (
              <span className="sr-only">
                {" "}
                · {t("当前证据级别", "Current evidence level")}
              </span>
            )}
          </li>
        ))}
      </ol>
      {level === null && (
        <small>{t("证据级别未知", "Evidence level unknown")}</small>
      )}
      {stale && (
        <span className="badge stale">
          {t("观测待更新", "Observation needs updating")}
        </span>
      )}
    </div>
  );
}
const decisions: Record<string, [string, string, string, string]> = {
  unknown: [
    "先核实原执行",
    "Reconcile the original Run",
    "当前副作用或状态无法确认；不要重放执行。",
    "Side effects or current state are unconfirmed; do not replay execution.",
  ],
  verification: [
    "验证 KR 证据",
    "Verify KR evidence",
    "实测已达标，仍需独立验证。",
    "The measured target is reached; independent verification is still required.",
  ],
  acceptance: [
    "验收最终成果",
    "Accept the final result",
    "KR 已验证，请复核成功标准并单独验收。",
    "KRs are verified; review success criteria and accept separately.",
  ],
  permission: [
    "检查执行资格",
    "Review execution authority",
    "约定要求的主机或实例资格不满足。",
    "Required Host or instance authority does not match the agreement.",
  ],
  budget: [
    "检查预算",
    "Review the budget",
    "没有未预留额度；新增支出需明确决定。",
    "No unreserved budget remains; new spending needs an explicit decision.",
  ],
  expired: [
    "更新执行约定",
    "Renew the agreement",
    "约定或命令已到期。",
    "The agreement or command has expired.",
  ],
  failed: [
    "检查失败原因",
    "Review the failure",
    "保留原 Run 和结果；下一次尝试需要新的决定。",
    "The original Run and result remain; a new attempt needs a new decision.",
  ],
};
/** OKR attention cards for "Needs your decision"; the caller renders the heading. */
export function Decisions({
  snapshot,
  now,
  reachable,
  t,
  open,
}: {
  snapshot: OrganizationSnapshot;
  now: bigint;
  reachable: boolean;
  t: Translate;
  open: (id: string) => void;
}) {
  const facts = decisionFacts(snapshot, now, reachable);
  if (facts.unavailable)
    return (
      <div className="note warn" role="status">
        <NavIcon name="alert" />
        <span>
          {t(
            "OKR 待办未知：请先恢复连接并重新查询，不能据此判断没有待办。",
            "OKR attention items are unknown. Restore the connection and query again; this does not mean there are none.",
          )}
        </span>
      </div>
    );
  if (!facts.items.length) return null;
  return (
    <div className="decision-grid">
      {facts.items.map(({ row, nav }) => {
        const copy = decisions[nav.condition];
        const budget = row.budget.value;
        const blocked = nav.condition === "unknown" || nav.condition === "failed";
        return (
          <article
            key={row.okr.id}
            className={`panel decision-card ${blocked ? "blocked" : ""}`}
          >
            <div className="d-top">
              <span className={`chip ${blocked ? "danger" : "warn"}`}>
                <NavIcon name="alert" />
                {t(copy[0], copy[1])}
              </span>
              <span title={row.okr.logical_id}>
                OKR {shortId(row.okr.logical_id)} · v{row.okr.agreement_version}
              </span>
            </div>
            <p>{t(copy[2], copy[3])}</p>
            <dl>
              <dt>{t("预算", "Budget")}</dt>
              <dd>
                {budget
                  ? `${budget.spent} + ${budget.reserved} / ${row.okr.budget_limit} ${budget.asset}`
                  : t("未知", "Unknown")}
              </dd>
              <dt>{t("替代方案", "Alternative")}</dt>
              <dd>
                {t(
                  "先查看原 Run 与证据，保持现有约定",
                  "Review the original Run and evidence; keep the agreement",
                )}
              </dd>
              <dt>{t("约定有效至", "Agreement expires")}</dt>
              <dd>{formatDeadline(row.okr.expires_at_ms, t)}</dd>
            </dl>
            <div className="actions">
              <button className="primary" onClick={() => open(row.okr.id)}>
                {t("查看事实与证据", "Review facts and evidence")}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
function formatDeadline(ms: string, t: Translate) {
  const n = Number(ms);
  return n > 0 && n <= 8640000000000000
    ? new Date(n).toISOString().replace("T", " ").replace(".000Z", " UTC")
    : t("未设置", "Not set");
}
export function OrganizationViews({
  organizations,
  current,
  select,
  t,
}: {
  organizations: Array<{ objectId: string; name: string; isActive: boolean }>;
  current: string;
  select: (id: string) => void;
  t: Translate;
}) {
  return (
    <>
      <h2>{t("我的组织", "My organizations")}</h2>
      <div className="card-grid">
        {organizations.map((org) => (
          <div className="panel" key={org.objectId}>
            <NavIcon name="layers" />
            <h3>{org.name}</h3>
            <p>
              {org.isActive
                ? t("链上组织已激活", "Organization active on chain")
                : t("链上组织未激活", "Organization inactive on chain")}
            </p>
            <code className="long-id">{org.objectId}</code>
            <div className="actions">
              <button
                disabled={org.objectId === current}
                onClick={() => select(org.objectId)}
              >
                {org.objectId === current
                  ? t("当前组织", "Current organization")
                  : t("切换到此组织", "Switch to this organization")}
              </button>
            </div>
          </div>
        ))}
      </div>
      {!organizations.length && (
        <div className="panel">
          {t("暂无链上组织。", "No on-chain organizations.")}
        </div>
      )}
      <h2>
        {t("从一个人，到开放网络", "From one person to the open network")}
      </h2>
      <p className="muted">
        {t(
          "成长路径说明；尚未实现的阶段只展示说明。",
          "A growth path overview; unavailable stages show explanations only.",
        )}
      </p>
      <div className="growth-path">
        {(
          [
            [
              "个人组织",
              "Personal organization",
              "与你的 Agent 达成可验证目标。",
              "Reach verifiable goals with your Agents.",
            ],
            [
              "团队",
              "Team",
              "以明确的角色、授权和边界协作。",
              "Collaborate with clear roles, authority and boundaries.",
            ],
            [
              "子组织",
              "Child organizations",
              "将职责分解为可独立验收的目标。",
              "Break responsibilities into independently accepted goals.",
            ],
            [
              "联邦",
              "Federation",
              "独立组织在开放网络中组合。",
              "Combine independent organizations in the open network.",
            ],
          ] as const
        ).map(([zh, en, dzh, den], i) => (
          <div className="panel" key={en}>
            <div className="fractal-stage" aria-hidden="true">
              {Array.from({ length: i + 1 }, (_, j) => (
                <span key={j} />
              ))}
            </div>
            <h3>{t(zh, en)}</h3>
            <p>{t(dzh, den)}</p>
            {i > 0 && (
              <small>
                {t(
                  "后续阶段 · 操作未接入",
                  "Future stage · actions not integrated",
                )}
              </small>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
