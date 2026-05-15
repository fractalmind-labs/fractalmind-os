# use-github-okr-skill

Run OKRs with GitHub Issues, Milestones, Labels, and GitHub Projects.

## What this skill does

- Converts Objectives and Key Results into GitHub-native artifacts.
- Supports company, team, KR, initiative, task, and PR alignment.
- Provides scripts for bootstrapping OKR cycles, adding issues to Projects, auditing alignment, and posting weekly KR updates.
- Keeps KRs metric-driven and avoids closing KR issues from task completion alone.

## Repository layout

- `SKILL.md`: main workflow and operating rules.
- `references/okr-templates.md`: Objective, KR, initiative, audit, and weekly update templates.
- `scripts/`: reusable GitHub OKR automation helpers.
- `agents/openai.yaml`: Codex app-facing metadata.

## Local usage

```bash
bash .codex/skills/use-github-okr/scripts/bootstrap-github-okr.sh \
  --cycle "OKR 2026 Q2" \
  --due 2026-06-30

python3 .codex/skills/use-github-okr/scripts/audit-okr-alignment.py \
  --repo OWNER/REPO \
  --milestone "OKR 2026 Q2"
```
