# FractalMind interactive prototype

A self-contained HTML prototype based on the [product PRD](../../docs/product/fractalmind-app-prd.md)
and [okr-manager skill](../../skills/coordination/okr-manager-skill/SKILL.md).
Styles, icons, sample data and interactions are embedded in `index.html`.
No package installation, external assets, model keys or backend services are required.

From the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory apps/fractalmind-prototype
```

Open <http://127.0.0.1:4173>. The HTML can also be opened directly; browser storage
availability for `file:` URLs may vary.

## OKR review paths

1. **OKR** opens **运行导航**: inspect the current KR / simulated run, route, last
   verified checkpoint, metric gap, budget, constraints and next action. Switch to
   **关键结果与计划** for weighted progress, trend, dependencies and the supporting
   task plan. **查看计算方式** explains the score.
2. **查看约定** → inspect or change scope, allowed actions, escalation rules, deadline
   and budget. The user confirms these boundaries and the verification method.
3. **演示自主推进** → the Agent advances KR2, records measurements, verifies evidence,
   then pauses before KR3's external service request. **审阅越界请求** → approve only
   this KR's verification, or reject and keep execution paused. After approval, the
   Agent continues autonomously through verification and final ACHIEVED status.
4. **模拟一次 heartbeat** advances one step for close inspection. A target measurement
   without verified evidence does not complete a KR. Task completion does not change
   the OKR score. Decreasing metrics use the same baseline-to-target calculation.
5. **新建 OKR** → define an objective, quantified success criteria, 1–3 result-oriented
   KRs, metrics, weights, dependencies, deliverables, verification and constraints.
   Confirm to activate or save in **候选**. At most three OKRs can be ACTIVE.
6. **查看约定** → set the budget to the amount already spent → advance a heartbeat
   to see the budget blocker. Increase the limit and confirm before resuming.
7. **导出 OKR.md** downloads only ACTIVE OKRs using the skill's Markdown structure.
   Full JSON export in settings includes candidates, achievements and demo history.
8. Use **手机** in the review bar to inspect mobile status, evidence and decisions.
   **查看推进记录** and **查看约定** expose details on small screens.

Other flows remain available: onboarding, spaces, Agent details, task evidence,
memory, simulated phone pairing with separate read/operate scopes, and organization
browsing. **模拟设备离线** in settings pauses autonomous execution and disables remote
operations. Reconnection requires explicit resume. Reloading pauses demo loops.

## Navigation review paths

- **注入演示场景 → 疑似空转**: three equivalent unsuccessful attempts are recorded;
  a heartbeat keeps the metric and budget unchanged. Inspect **查看判断依据**, then
  **重新规划并推进** to test route B under the existing scope and verification rules.
- **路径阻断**: route A is stopped by a simulated code-upload restriction. **切换本地路线 B**
  abandons the external operation; it does not approve the original external request.
- **临近边界**: inject a next-action estimate that exceeds the remaining budget. No
  spend or metric change occurs; review the contract or choose a cheaper local route.
- **等待依赖**: a live test within its expected wait window is shown separately from
  a loop. **模拟依赖返回** resumes after constraints are checked.
- **失去观测**: location and spend are marked as historical/unknown. **恢复观测（演示）**
  reconciles the snapshot and leaves execution paused for explicit resumption.
- Navigation and results use the same OKRs, measurements and simulator. Only verified
  KRs unlock downstream work; sampling alone is not labeled as a verified checkpoint.
- Scenarios pause the selected OKR and inject labeled demo observations. They retain
  previous metrics and evidence. **正常推进** clears the injected scenario, while
  actual budget, deadline, dependency and authorization checks still apply.

## Data and limitations

The review bar labels the entire prototype as demo data. All measurements, evidence,
verification, costs, execution, approvals, devices and organizations are simulated.
No repository files are modified, messages sent, services purchased, credentials
created or chain transactions submitted by these workflows. The external service
request is a fixed sample scenario. Free-text constraints are interaction concepts,
not a policy engine. The verification simulator assumes the user-confirmed success
criteria are covered by the configured KRs; production must implement explicit
criteria mapping, real measurements, verifiers and authority checks.

Changes persist in `fractalmind.product-prototype.v2` local storage. The earlier v1
entry is left untouched; this demo does not migrate it. **重置演示** restores sample
OKRs and stops all pending simulation timers. **导出演示数据** downloads the complete
v2 state as JSON. The prototype does not implement the PRD's native platform,
security, localization, file synchronization, background runtime or protocol features.

Navigation state and its event history are stored within the existing v2 demo state.
Older v2 entries initialize navigation lazily; no user metrics are reset on reload.
