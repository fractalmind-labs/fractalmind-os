---
name: use-github-okr
description: Use when creating, updating, reviewing, aligning, or operationalizing OKRs in GitHub with Issues, Milestones, Labels, and GitHub Projects. Trigger for requests such as creating an OKR example, setting up an OKR cycle, converting Objectives and Key Results into GitHub issues, splitting OKRs into company/team/KR/initiative layers, aligning team OKRs to parent KRs, auditing OKR hierarchy alignment, weekly OKR updates, KR health/confidence tracking, or explaining how to manage OKRs in GitHub.
---

# Use GitHub OKR

Use this skill to turn OKRs into GitHub-native execution artifacts.

Default to a repo-backed workflow when the user asks to create or manage OKRs. Prefer GitHub Issues plus Milestones plus Projects over chat-only plans.

## Core Model

- GitHub Project: one OKR cycle, for example `OKR 2026 Q2`.
- Milestone: the time box or release gate for the same cycle.
- Objective issue: one issue per Objective, labeled `okr` and `okr:objective`.
- Key Result issue: one issue per measurable KR, labeled `okr` and `okr:key-result`.
- Initiative/task issues: concrete work linked from a KR issue. PRs close these task issues, not KR issues directly.
- Weekly update: comment on each KR issue with current value, health, confidence, risks, and next action.

Milestones are repo-scoped. GitHub Projects can be org-scoped and can contain issues across repos. If the OKR spans multiple repos, prefer an org Project and per-repo milestones or labels.

## Alignment Model

Represent vertical decomposition with issue parent/child relationships or explicit links in the issue body. Represent horizontal alignment with Project fields.

Preferred hierarchy:

```text
OKR cycle / GitHub Project
└── Company Objective issue
    └── Company KR issue
        └── Team Objective issue
            └── Team KR issue
                └── Initiative or task issue
                    └── PR
```

Keep the tree shallow when possible. Most teams should use:

```text
Objective -> Key Result -> Initiative -> Task/PR
```

Use GitHub sub-issues or the built-in `Parent issue` / `Sub-issues progress` Project fields when available. If the local `gh` version cannot create sub-issues, preserve the hierarchy with explicit issue body sections:

- `Parent Objective`
- `Parent KR`
- `Children`
- `Contribution type`
- `Alignment rationale`

Alignment fields to add to the Project when useful:

- `Company Objective` text
- `Parent KR` text
- `Team` text or single select
- `OKR Type` single select: `Objective`, `Key Result`, `Initiative`, `Task`
- `Alignment` single select: `Direct`, `Supporting`, `Dependency`
- `Health` single select: `Green`, `Yellow`, `Red`
- `Confidence` number
- `Target` and `Current`

## Alignment Rules

- Every team Objective must map to exactly one parent company KR unless the user explicitly wants a portfolio or exploratory item.
- Every team KR must explain how it changes the parent KR metric, not merely claim topic similarity.
- Every initiative must link to a KR. If it does not contribute to a KR, keep it out of the OKR Project.
- PRs and implementation tasks close task or initiative issues. They should not close KR issues directly.
- Close a KR only when the metric target is achieved and evidence is linked.
- Mark dependency-only work with `Alignment: Dependency`; do not count it as direct KR progress unless the parent metric moves.

When asked to align OKRs, produce both:

- hierarchy: who supports whom
- contribution logic: why that support moves the parent metric

## First Pass

1. Resolve the GitHub repo and owner:

```bash
gh repo view --json nameWithOwner,url
gh auth status
```

2. Check existing OKR artifacts before creating duplicates:

```bash
gh issue list --state all --search '"OKR 2026 Q2" in:title' --json number,title,state,url --limit 50
gh api --method GET repos/:owner/:repo/milestones -f state=all --jq '.[] | [.number,.title,.state,.due_on] | @tsv'
gh project list --owner <owner-or-org> --format json --limit 100
```

3. Decide whether the user wants an example, a real cycle, or an update to an existing cycle.

Use an explicit title prefix for examples, such as `[OKR Example 2026 Q2]`, and label them `okr:example` so they are easy to find and remove.

## Create An OKR Cycle

Use these artifacts unless the user asks for a different structure:

- labels: `okr`, `okr:objective`, `okr:key-result`; add `okr:example` for demos.
- milestone: same title as the OKR cycle, with a due date when known.
- Project fields:
  - `Objective` text
  - `KR` text
  - `Company Objective` text, when multiple Objective levels exist
  - `Parent KR` text, when team OKRs align to company KRs
  - `Team` text or single select, when multiple teams contribute
  - `OKR Type` single select: `Objective`, `Key Result`, `Initiative`, `Task`
  - `Alignment` single select: `Direct`, `Supporting`, `Dependency`
  - `Health` single select: `Green`, `Yellow`, `Red`
  - `Confidence` number
  - `Target` text or number
  - `Current` text or number
  - `Due` date, if field creation works in the local `gh` version

Create or update labels idempotently:

```bash
gh label create okr --color 5319E7 --description "OKR tracking item" --force
gh label create okr:objective --color 1D76DB --description "OKR Objective issue" --force
gh label create okr:key-result --color 0E8A16 --description "OKR Key Result issue" --force
```

Create a milestone with REST when `gh milestone` is unavailable:

```bash
gh api --method POST repos/:owner/:repo/milestones \
  -f title="OKR 2026 Q2" \
  -f due_on="2026-06-30T23:59:59Z" \
  -f description="OKR cycle tracking Objective and Key Result issues."
```

Create issues from templates. Read [references/okr-templates.md](references/okr-templates.md) for Objective, KR, Initiative, and weekly update templates.

Create an org Project when the owner is an organization:

```bash
gh project create --owner <org> --title "OKR 2026 Q2" --format json
gh project field-create <project-number> --owner <org> --name "Objective" --data-type TEXT
gh project field-create <project-number> --owner <org> --name "KR" --data-type TEXT
gh project field-create <project-number> --owner <org> --name "Parent KR" --data-type TEXT
gh project field-create <project-number> --owner <org> --name "Team" --data-type TEXT
gh project field-create <project-number> --owner <org> --name "OKR Type" --data-type SINGLE_SELECT --single-select-options "Objective,Key Result,Initiative,Task"
gh project field-create <project-number> --owner <org> --name "Alignment" --data-type SINGLE_SELECT --single-select-options "Direct,Supporting,Dependency"
gh project field-create <project-number> --owner <org> --name "Health" --data-type SINGLE_SELECT --single-select-options "Green,Yellow,Red"
gh project field-create <project-number> --owner <org> --name "Confidence" --data-type NUMBER
gh project item-add <project-number> --owner <org> --url "<issue-url>"
```

Avoid using a Project field named `Type`; GitHub can treat it as reserved or already taken. Use `OKR Type`.

## Split And Align OKRs

When the user asks to break down or align OKRs:

1. Identify the top-level Objective and KRs.
2. For each team or product area, create team Objectives only where a team can own a meaningful outcome.
3. For each team KR, require:
   - parent Objective
   - parent KR
   - contribution type: `Direct`, `Supporting`, or `Dependency`
   - metric baseline, target, current, owner, and due date
   - short alignment rationale
4. Create initiative/task issues only after KRs are measurable.
5. Add all issues to the OKR Project and set alignment fields when possible.
6. If GitHub sub-issues are available, use them for the parent/child tree; otherwise add explicit links in issue bodies and comments.

Use [references/okr-templates.md](references/okr-templates.md) for hierarchy and alignment sections.

## Scripts

Use bundled scripts for repeatable GitHub OKR operations. Prefer them over retyping long `gh` command sequences.

Bootstrap labels, milestone, Project, and common Project fields:

```bash
bash .codex/skills/use-github-okr/scripts/bootstrap-github-okr.sh \
  --cycle "OKR 2026 Q2" \
  --due 2026-06-30
```

Add OKR issues from a milestone to a Project:

```bash
bash .codex/skills/use-github-okr/scripts/add-okr-issues-to-project.sh \
  --owner OWNER \
  --project-number 7 \
  --milestone "OKR 2026 Q2"
```

Audit OKR issue hierarchy and alignment hygiene:

```bash
python3 .codex/skills/use-github-okr/scripts/audit-okr-alignment.py \
  --repo OWNER/REPO \
  --milestone "OKR 2026 Q2"
```

Post a standardized weekly KR update:

```bash
bash .codex/skills/use-github-okr/scripts/post-okr-weekly-update.sh \
  --issue 123 \
  --current "10%" \
  --target "25%" \
  --health Yellow \
  --confidence 0.60 \
  --progress "Invite funnel events are defined" \
  --next "Wire dashboard readout" \
  --evidence "https://github.com/OWNER/REPO/issues/123"
```

## Audit OKR Alignment

When checking whether OKRs are aligned, flag these problems:

- orphan team Objective: no parent company KR
- orphan initiative: no parent KR
- vague KR: no metric, target, current value, owner, or evidence source
- weak alignment: child KR describes work output but not parent metric movement
- duplicate KR: multiple teams own the same metric without a split by scope
- dependency mislabeled as direct contribution
- stale KR: no weekly update in the expected cadence
- closed task claimed as KR success without metric evidence

Suggested views:

- `Hierarchy`: parent Objective -> KR -> team Objective -> team KR -> initiative
- `By Objective`: group by `Company Objective`
- `By Team`: group by `Team`
- `KR Health`: filter `OKR Type:Key Result`
- `Misaligned`: missing `Parent KR`, owner, metric, or evidence
- `Blocked Dependencies`: `Alignment:Dependency` and `Health:Red`

## Update OKR Progress

For weekly check-ins:

1. Read Objective and KR issues for the cycle.
2. Read Project items if a Project exists.
3. Update the KR issue body only when the user explicitly wants the canonical current values changed.
4. Otherwise add a weekly comment using the weekly update template.
5. Update Project fields when field ids and option ids can be resolved cleanly.

Use the KR issue as the metric source of truth. The Project is the dashboard.

## Reporting

When summarizing OKR status, report:

- OKR cycle title and GitHub Project link, if present
- milestone link and open/closed counts
- Objective issues
- KR issues with current, target, health, confidence, owner, and due date
- parent/child alignment for team Objectives and KRs
- direct/supporting/dependency contribution types
- blockers and missing hygiene: no owner, no metric, no current value, stale weekly update, no linked work

Be explicit when something is an example artifact rather than a real company OKR.

## Safety

- Do not create duplicate OKR cycles if matching issues, milestones, or Projects already exist.
- Do not close KR issues just because tasks or PRs closed. Close a KR only when the metric target is achieved and evidence is linked.
- Do not overwrite real OKR issue bodies without checking the existing content first.
- Do not assume Project custom field creation succeeded; re-read fields and items after mutation.
- If a `gh project` command hangs or returns a transient conflict, retry only the failed item or field instead of rerunning the whole workflow.
