
---
description: Turnkey GitHub Issues workflow (triage → plan → PR → review → merge)
---

# GitHub Issues Workflow

## Multi-Repo Support
This workflow supports **multiple repositories** simultaneously. Any git repo under `workspace/` is maintained independently using the same workflow.

Agents should iterate through all repos under `workspace/` when looking for work, unless explicitly assigned to a specific repo.

To list repos (directory name + detected GitHub slug):
```bash
bash scripts/workspace-repos.sh
```

## Goal
Provide a repeatable, out-of-the-box workflow for turning GitHub Issues into shipped code changes with clear planning, ownership, and review loops.

## Prerequisites

### Tools
- `gh` installed and authenticated (`gh auth status`)

### Workspace setup (recommended)
Clone target repositories into `workspace/` as normal git clones (not submodules). The `workspace/` directory is intended to be gitignored in this repo.

```bash
# from the oh-my-code repo root
mkdir -p workspace

# clone a repo (example)
git clone "git@github.com:OWNER/REPO.git" "workspace/repo"
```

#### Working with a specific repo
When implementing work, set the target repo context:

```bash
TARGET_REPO="repo"
TARGET_PATH="workspace/$TARGET_REPO"
GITHUB_REPO="$(bash scripts/github-repo-from-origin.sh "$TARGET_PATH")"
```

If the repo has no `origin` remote or it is not a GitHub URL, set `GITHUB_REPO` manually (e.g. `OWNER/REPO`).

## Label Conventions (Recommended)

### Team ownership (avoid duplicate work)
Use exactly one `team:*` label to claim an issue.
- Example: `team:core`, `team:frontend`, `team:infra`

### Status tracking
- `status:in-progress`
- `status:blocked`
- `status:done`
- `status:awaiting-human-merge` (optional, for queues)

## Workflow

## Assignment scope (mandatory)

Agents MUST only work on Issues that are assigned to the current GitHub account (i.e. `assignee:@me`).

- Do not triage, claim, or start work on Issues assigned to someone else or unassigned.
- Ignore other Issues entirely unless the human explicitly instructs you to work on them.
- If you need an Issue assigned to proceed, ask the human to assign it rather than self-assigning.

```mermaid
graph TD
    Start[Start work cycle] --> Sync[List open issues]
    Sync --> Prioritize[Sort by priority/deps]
    Prioritize --> Next{Any available issues?}

    Next -->|No| Idle[Idle / wait]
    Next -->|Yes| Pick[Pick highest priority]

    Pick --> Claim[Claim: add team + status:in-progress]
    Claim --> ClaimCheck{Claim succeeded?}
    ClaimCheck -->|No| Pick
    ClaimCheck -->|Yes| Understand[Understand requirements]

    Understand --> Plan[Plan options]
    Plan --> OptionGate{Multiple viable options?}
    OptionGate -->|Yes| HumanChoice[Ask human to pick option]
    HumanChoice --> Implement
    OptionGate -->|No| Implement[Implement]

    Implement --> PR[Create PR]
    PR --> Review[Review / QA]
    Review --> PassFail{PASS/FAIL?}

    PassFail -->|FAIL| Fix[Fix + push]
    Fix --> Review

    PassFail -->|PASS| MergeWait[Wait for merge]
    MergeWait --> Merged{Merged?}
    Merged -->|No| MergeWait
    Merged -->|Yes| Done[Mark issue status:done]
    Done --> Sync
```

## Step-by-step Commands

### 1) Find work
```bash
gh issue list --repo "$GITHUB_REPO" --state open --assignee @me
```

To list your assigned Issues across all repos in `workspace/`:
```bash
for TARGET_PATH in workspace/*; do
  [ -d "$TARGET_PATH/.git" ] || continue
  GITHUB_REPO="$(bash scripts/github-repo-from-origin.sh "$TARGET_PATH")"
  gh issue list --repo "$GITHUB_REPO" --state open --assignee @me
done
```

To quickly find an unclaimed issue (no `team:*` labels) across all repos in `workspace/` (ONLY when explicitly instructed to pick up unassigned work):
```bash
bash scripts/workspace-next-issue.sh
```

### 2) Claim an issue (recommended)
Pick an issue number (that is assigned to you), then claim it:
```bash
ISSUE_NUMBER=123
TEAM_LABEL="team:core"

gh issue edit "$ISSUE_NUMBER" --repo "$GITHUB_REPO" \
  --add-label "$TEAM_LABEL" \
  --add-label 'status:in-progress'
```

If claiming fails (race with another team), pick another issue.

### 3) Understand → Plan (mandatory for non-trivial work)

#### Understand
- Summarize requirements, constraints, and acceptance criteria.
- Identify edge cases, risks, and test strategy.

#### Plan options
Use this structure:

**Option 1: <name>**
- Approach
- Pros/Cons
- Risk level
- Effort estimate

**Option 2: <name>**
- Approach
- Pros/Cons
- Risk level
- Effort estimate

**Recommendation**: Option X

#### Technical design review (required when design matters)
If the issue needs a technical design decision (multiple viable approaches, tradeoffs, migrations, risky changes):
1. Post the options + recommendation as an **Issue comment**.
2. Explicitly ask the human to pick an option (or approve the recommendation).
3. STOP and wait for a human reply before implementing.

Example (comment options on the Issue):
```bash
gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --body-file - <<'EOF'
Design options:

Option 1: <name>
- Approach:
- Pros/Cons:
- Risks:
- Effort:

Option 2: <name>
- Approach:
- Pros/Cons:
- Risks:
- Effort:

Recommendation: Option X because <reason>.

Question for human: Please reply with "Option 1" / "Option 2" (or edits) before I implement.
EOF
```

Newline reminder (important):
- If you pass multi-line text via `--body "line1\nline2"`, GitHub may show the literal `\n` instead of a line break.
- Prefer `--body-file` (as above) or `--editor` to preserve newlines reliably.

To check for the human reply:
```bash
gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --comments
```

### 4) Implement → PR

Create a PR that links the issue:
```bash
gh pr create --repo "$GITHUB_REPO" --fill --title "<title>" --body "Closes #$ISSUE_NUMBER"
```

Newline reminder (important):
- Avoid embedding `\n` in `--body "..."` / `--comment "..."` strings.
- Prefer `--body-file` for multi-line PR descriptions, e.g.:
  `gh pr create ... --body-file - <<'EOF'`

### 5) Review loop (PASS/FAIL)
Run quality gates in the repo you changed before calling it PASS:
```bash
# from oh-my-code repo root
bash scripts/quality-gates.sh --repo "$TARGET_PATH"
```

For a quick checks snapshot:
```bash
gh pr view --repo "$GITHUB_REPO" --json number,title,state,mergeable,reviewDecision,statusCheckRollup
```

### 6) Merge policy (human-only)

Agents (all `EMP_*`) MUST NOT merge PRs.
- Do not run `gh pr merge` (or any equivalent).
- Do not click “Merge” in the GitHub UI.
- When QA/review is PASS and checks are green: mark as waiting, notify the human owner, then stop.
- If there are already 3+ pending human merges (`status:awaiting-human-merge`), do not add another one; idle instead.

```bash
gh issue edit "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --add-label 'status:awaiting-human-merge'
```

### 7) Close the loop after merge
After PR is merged:
```bash
gh issue edit "$ISSUE_NUMBER" --repo "$GITHUB_REPO" \
  --remove-label 'status:in-progress' \
  --add-label 'status:done'
```

## Output Contract (for agents)

Every work cycle update ends with:
1. **Summary** (1–3 bullets)
2. **Evidence** (exact commands run + outcomes)
3. **Files Changed** (paths)
4. **Risks/Assumptions**
5. **Next Step**

## Rule: Awaiting human merge cap (max 3)

Agents MUST keep the number of PRs waiting on a human merge/review capped at 3.
If the cap is reached, agents stop starting new work and can idle until the count drops.

Check the current queue size:
```bash
gh search issues --repo "$GITHUB_REPO" --state open --label 'status:awaiting-human-merge' --json number --jq 'length'
```
