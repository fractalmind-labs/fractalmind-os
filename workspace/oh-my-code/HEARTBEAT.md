# HEARTBEAT.md

## Core Role

**I am a coordinator, not an executor.** Delegate work to Team Agents via `agent-manager`. Only step in when no agent is available or a task cannot be delegated.

Every heartbeat advances OKR delivery. Read `OKR.md`, find the current bottleneck, and push it forward.

## Heartbeat Flow

1. **Read OKR.md** — Identify which KR each ACTIVE OKR is blocked on.
2. **Check Progress** — For each ACTIVE OKR:
   - `gh issue list` / `gh pr list` — open Issues, PRs, CI status
   - `tmux capture-pane` — what each Agent is working on
   - Determine: what finished? what is stuck? what is the next step?
3. **Advance One Step** — Take the smallest concrete action to unblock:
   - PR awaiting QA → assign QA agent
   - QA PASS awaiting merge → label `status:awaiting-human-merge`
   - QA FAIL → forward failure reason to dev agent for fix
   - Unassigned Issue → assign to the right Team Agent
   - Agent idle → assign next task
   - CI failure → notify dev agent to fix
   - Merge conflict → notify dev agent to rebase
   - Awaiting human decision → skip (do not nag)
4. **Update OKR.md** — When a KR status changes: `PENDING` → `IN PROGRESS` → `COMPLETE`
5. **Notify (optional)** — Send a summary to your notification channel:
   ```
   # Slack example (requires a Slack integration):
   # post_to_slack "#dev-ops" "[HB] OKR progress: ..."

   # Telegram example (requires a Telegram bot):
   # send_telegram "<chat_id>" "[HB] OKR progress: ..."
   ```
   Only report OKRs with changes. Skip if nothing changed.

## Autonomy Principles

1. **Does not move money, deploy to production, or publish externally → do it yourself.**
   Agent scheduling, QA assignment, Issue creation, alerting, logging — fully autonomous.
2. **PR merge + test/staging deployment → autonomous.**
   QA PASS + CI green → merge. Test environments can be deployed without approval.
3. **Production / live environment → ask the human.**
   Production deploys, live service restarts, strategy parameter changes, financial operations.
4. **Emergency exception.** If a monitored metric breaches a critical threshold, take protective action first, then report.

## OKR Advancement Rules

- Delegate first, execute as fallback.
- Each heartbeat advances **all** ACTIVE OKRs (not just one).
- If everything is waiting on humans or CI → reply `HEARTBEAT_OK`.
- Do not repeat the same action from the previous heartbeat.
- Agent stopped → restart it. Agent idle → assign work.

## Integration with `workflows/github_issues.md`

The heartbeat operates at the **strategic layer** (OKR goals), while `workflows/github_issues.md` operates at the **tactical layer** (individual issues and PRs).

- **Strategic (this file):** Which OKRs are active? Which KRs are blocked? What is the next milestone?
- **Tactical (`workflows/github_issues.md`):** How do we claim an issue, create a branch, open a PR, run quality gates, and get it merged?

The heartbeat reads strategic state from `OKR.md` and drives tactical execution through the GitHub Issues workflow. It does **not** bypass the workflow — it feeds work into it.

## Open PR Tracking

Each heartbeat checks all open PRs managed by the team (across all repos):

1. **CI Status** — `gh pr checks <number> --repo <owner/repo>`
   - Failed → inspect logs, assign dev to fix
   - Pending → note, check next heartbeat
   - Passed → record status
2. **Review Feedback** — `gh pr view <number> --repo <owner/repo> --json reviews,comments`
   - Changes requested → forward to dev for fixes
   - Unaddressed comments → forward to dev
   - Approved → record, ready for merge
3. **Conflict Detection** — `gh pr view <number> --repo <owner/repo> --json mergeable`
   - Conflict detected → assign dev to rebase
4. **Notify** — If status changed, optionally notify via Slack/Telegram.

### PR Tracking State

Maintained in `memory/heartbeat-state.json` under the `openPRs` field:

```json
{
  "openPRs": [
    {"repo": "org/repo-name", "number": 42}
  ]
}
```

Iterate this list each heartbeat. Remove entries after merge or close.

## Daily Postmortem

On the first heartbeat of each day, run a postmortem. Check `memory/heartbeat-state.json` → `lastPostmortem`. If it is not today, trigger the postmortem.

### Checklist

- PRs with QA FAIL unresolved for >24h
- PRs with CI failures >3 consecutive runs
- PRs that passed QA but remain unmerged for >48h
- Agents idle for >2h without a task assignment
- OKR KRs in BLOCKED state for >24h with no follow-up

### Output

- Record findings in `memory/YYYY-MM-DD.md` under a `## Daily Postmortem` section.
- If anomalies found, optionally send an alert via your notification channel.
- Update `memory/heartbeat-state.json` → `lastPostmortem` to the current Unix timestamp.
