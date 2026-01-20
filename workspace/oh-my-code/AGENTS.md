
# oh-my-code (Process-Oriented Agent Rules)

This project exists to replicate the *final working effect* of `oh-my-opencode` **without** relying on in-session hooks/tools.

Instead, we enforce a high-quality, repeatable engineering workflow via:
- `AGENTS.md` rules + templates (session-internal discipline)
- `agent-manager` + tmux sessions (session-external parallelism)

## Scope Rules (Anti-Drift)
- Do only what the user asked; stop exploring once you have enough context to proceed.
- Never modify unrelated repositories or paths outside the task scope.
- Before any work that changes files, capture baseline: `git status --porcelain`.

## Exploration Budget (Anti-Drift)
- Hard stop and ask the user before exceeding:
  - 10 minutes of exploration without starting an implementation, or
  - 10 `rg`/search commands, or
  - 8 file reads outside the files you will actually change.

## Startup (Required)
1. Read nearest `AGENTS.md` (this file).
2. Confirm prerequisites:
   - `python3` available
   - `tmux` available
   - you are at repo root (`pwd` shows the `oh-my-code` directory)
 3. Run preflight: `bash scripts/preflight.sh`

## Target Effects (What we replicate)
- Parallelize work across multiple CLI agents (dev/qa/etc) using separate tmux sessions.
- Prevent drift by enforcing scope rules + evidence.
- Make outputs verifiable and repeatable via a strict output contract.
- Ensure quality gates are run and reported.

## Roles (Recommended)
- **sisyphus**: the orchestrator (recommended model: anthropic/claude-opus-4-5)
- **oracle**: architecture, code review, strategy (recommended model: openai/gpt-5.2)
- **librarian**: multi-repo analysis, doc lookup (recommended model: opencode/glm-4.7-free)
- **explore**: fast codebase exploration (recommended model: grok/gemini/haiku)
- **frontend-ui-ux-engineer**: UI/UX specialist (recommended model: google/gemini-3-pro-preview)
- **document-writer**: technical writing (recommended model: google/gemini-3-flash)
- **multimodal-looker**: PDF/image analysis (recommended model: google/gemini-3-flash)

## Multi-Agent Protocol (agent-manager)
Use `agent-manager` to run workers in separate tmux sessions, then feed tasks in parallel.

This repo vendors `agent-manager` under `.claude/skills/agent-manager`, so it works after a plain git clone (no `openskills install` required). You only need `python3` and `tmux` available.

If you are using a different CLI (e.g. `droid` or `claude`), update `agents/EMP_0001.md` and `agents/EMP_0002.md` to point `launcher:` to your CLI.

### Commands
```bash
# list agents
python3 .claude/skills/agent-manager/scripts/main.py list

# start if needed
python3 .claude/skills/agent-manager/scripts/main.py start sisyphus
python3 .claude/skills/agent-manager/scripts/main.py start oracle

# assign tasks (stdin)
python3 .claude/skills/agent-manager/scripts/main.py assign sisyphus <<'EOF'
<task>
EOF

# monitor
python3 .claude/skills/agent-manager/scripts/main.py monitor sisyphus --follow

# stop
python3 .claude/skills/agent-manager/scripts/main.py stop sisyphus
```

## Task Decomposition Template
When you are orchestrator, produce a short split like:
- Subtask A (Dev): implement
- Subtask B (QA): validate + edge cases
- Subtask C (Optional): quick research

Each subtask must have:
- Objective
- Exact deliverable(s)
- “Done” criteria

## Output Contract (Mandatory)
Every agent response must end with:
1. **Summary**: 1–3 bullets.
2. **Evidence**: exact commands run + brief outcome.
3. **Files Changed**: paths.
4. **Risks/Assumptions**: anything uncertain.
5. **Next Step**: what to do next (or “ready for review”).

### Short Form (No Code / No File Changes)
If you did not run tools and did not change files, keep the same 5 sections but use 1 line each (Evidence can be “None”).

## Quality Gates
- If code changed: run the project’s relevant `format/lint/typecheck/test/build` commands and report results.
- If only docs/rules changed: at minimum ensure the file is readable and references valid paths.

### Default Quality Gates Command
Prefer running the repo-local wrapper (auto-detects common stacks and supports `--mode check|fix`):

```bash
bash scripts/quality-gates.sh --repo <changed-repo-path>
```

Default order (when available): `format → lint → typecheck → test → build`.

If auto-detection is insufficient, set `QUALITY_GATES` to explicit commands.

## When To Use agent-manager
- Use agent-manager when there are parallel tracks (implementation + QA + docs) or uncertainty that benefits from a second opinion.
- Skip agent-manager for tiny single-file edits, quick Q&A, or tasks that complete in <10 minutes.

Quick decision table:
- Start agent-manager: multi-file change, risky migration, flaky tests, unclear requirements, or “ship today” urgency.
- Don’t start: docs-only edits, one-liner fixes, simple refactors with local tests.

## Safety
- Never commit or push unless explicitly asked.
- Never add secrets/keys; never paste tokens into logs.

## Troubleshooting

### Agent not starting (tmux session issues)

**Symptoms:**
- `python3 .claude/skills/agent-manager/scripts/main.py start <agent>` fails
- Error: "tmux session already exists" or "tmux not found"

**Resolution:**
```bash
# Check if tmux is installed
tmux -V

# List existing tmux sessions
tmux list-sessions

# Kill stuck session (replace name with actual agent name)
tmux kill-session -t sisyphus

# Verify agent-manager scripts are executable
chmod +x .claude/skills/agent-manager/scripts/main.py
```

### Agent not responding (health check failures)

**Symptoms:**
- `assign` command hangs or times out
- `monitor` shows no output

**Resolution:**
```bash
# Check if agent session is running
python3 .claude/skills/agent-manager/scripts/main.py list

# Attach to session directly to inspect
tmux attach-session -t sisyphus
# Press Ctrl+B then D to detach without killing

# Restart the agent
python3 .claude/skills/agent-manager/scripts/main.py stop sisyphus
python3 .claude/skills/agent-manager/scripts/main.py start sisyphus
```

### Log file location and interpretation

**Symptoms:**
- Need to debug past agent behavior
- Want to review conversation history

**Resolution:**
```bash
# Agent logs are stored in tmux session buffer
tmux capture-pane -t sisyphus -p > /tmp/agent.log

# For workspace-specific logs, check:
ls -la ~/.cache/claude/  # or your CLI's cache directory

# Check agent-manager status
python3 .claude/skills/agent-manager/scripts/main.py status
```

### Common CLI path issues

**Symptoms:**
- Agent launches but uses wrong CLI (e.g., `droid` instead of `claude`)
- Launcher not found errors

**Resolution:**
```bash
# Verify your CLI is on PATH
which claude  # or droid, etc.

# Update agent configuration
# Edit agents/EMP_0001.md and agents/EMP_0002.md
# Set the correct `launcher:` path

# Reload agent after config change
python3 .claude/skills/agent-manager/scripts/main.py stop <agent>
python3 .claude/skills/agent-manager/scripts/main.py start <agent>
```
