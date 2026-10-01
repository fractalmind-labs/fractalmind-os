import type { ReactNode } from "react";
import type { OrganizationSnapshot } from "./domain";
import { decisionFacts, type TrustLevel } from "./v2-model";

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
};
export function NavIcon({ name }: { name: string }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
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
  return (
    <section
      className="decisions"
      aria-label={t("需要你决定", "Needs your decision")}
    >
      <div className="section-heading">
        <h2>{t("需要你决定", "Needs your decision")}</h2>
        {!facts.unavailable && (
          <span className="badge">
            {facts.items.length} {t("项 OKR 需关注", "OKRs need attention")}
          </span>
        )}
      </div>
      <p className="muted">
        {t(
          "根据已读取的链上事实整理；完整审批队列与设备配对请求待接入。",
          "Based on the chain records read here; the full approval queue and device pairing requests are not connected yet.",
        )}
      </p>
      {facts.unavailable ? (
        <div className="panel warn" role="status">
          {t(
            "当前数据未知，请先恢复连接并重新查询。",
            "Current data is unknown. Restore the connection and query again.",
          )}
        </div>
      ) : facts.items.length ? (
        <div className="decision-grid">
          {facts.items.map(({ row, nav }) => {
            const copy = decisions[nav.condition];
            const budget = row.budget.value;
            return (
              <article
                key={row.okr.id}
                className={`panel decision-card ${nav.condition === "unknown" || nav.condition === "failed" ? "blocked" : ""}`}
              >
                <div className="decision-title">
                  <span className="decision-signal" aria-hidden="true">
                    !
                  </span>
                  <div>
                    <h3>{t(copy[0], copy[1])}</h3>
                    <small>{row.okr.logical_id}</small>
                  </div>
                </div>
                <p>{t(copy[2], copy[3])}</p>
                <dl>
                  <dt>{t("影响范围", "Scope")}</dt>
                  <dd>
                    {t("此 OKR", "This OKR")} · v{row.okr.agreement_version}
                  </dd>
                  <dt>{t("预算影响", "Budget effect")}</dt>
                  <dd>
                    {budget
                      ? `${budget.spent} + ${budget.reserved} / ${row.okr.budget_limit} ${budget.asset}`
                      : t("未知", "Unknown")}{" "}
                    · {t("新动作费用待评估", "New action cost not estimated")}
                  </dd>
                  <dt>{t("替代方案", "Alternative")}</dt>
                  <dd>
                    {t(
                      "先查看原 Run 与证据，保持现有约定。",
                      "Review the original Run and evidence; retain the current agreement.",
                    )}
                  </dd>
                  <dt>{t("约定有效至", "Agreement expires")}</dt>
                  <dd>{formatDeadline(row.okr.expires_at_ms, t)}</dd>
                </dl>
                <button onClick={() => open(row.okr.id)}>
                  {t("查看事实与证据", "Review facts and evidence")} →
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          {t(
            "已读取的 OKR 中未发现需处理事项。实时 Agent 观测尚未接入，不能据此判断持续运行正常。",
            "No attention items in the OKRs read. Live Agent observations are not connected, so this does not establish healthy ongoing execution.",
          )}
        </div>
      )}
    </section>
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
