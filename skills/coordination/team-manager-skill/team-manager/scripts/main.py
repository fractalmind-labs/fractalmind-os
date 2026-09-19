#!/usr/bin/env python3
"""
Team Manager - CLI for managing teams and assigning tasks.

Depends on agent-manager for individual agent management.
Team members are referenced by employee ID (e.g., EMP_0001).
Workflow is defined in the team configuration body using mermaid diagrams.
"""

import argparse
import sys
import os
import subprocess
from pathlib import Path
from datetime import datetime, timezone

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent))

from repo_root import get_repo_root, find_agent_manager_scripts_dir, get_skill_search_dirs


# Ensure repo-root relative paths and ${REPO_ROOT} expansions work even when invoked
# from a subdirectory (e.g., inside projects/*) or via a globally installed skill.
_REPO_ROOT = get_repo_root()
os.environ.setdefault('REPO_ROOT', str(_REPO_ROOT))
_AGENTS_DIR = _REPO_ROOT / 'agents'

_AGENT_MANAGER_SCRIPTS_DIR = find_agent_manager_scripts_dir(_REPO_ROOT)
if _AGENT_MANAGER_SCRIPTS_DIR:
    sys.path.insert(0, str(_AGENT_MANAGER_SCRIPTS_DIR))


def _read_skill_md(skill_name: str, repo_root: Path) -> str:
    for root in get_skill_search_dirs(repo_root):
        candidate = root / skill_name / 'SKILL.md'
        if candidate.exists() and candidate.is_file():
            return candidate.read_text(encoding='utf-8')
    raise FileNotFoundError(f"Skill not found: {skill_name}")

from team_config import (
    list_all_teams,
    resolve_team,
    get_team_members,
    get_lead_agent_id,
    get_team_body,
    get_team_working_directory,
    validate_team_config,
    get_teams_dir,
)

# Import agent-manager helpers
try:
    from agent_config import resolve_agent
except ImportError:
    # Fallback if agent-manager is not available
    def resolve_agent(name, agents_dir=None): return None

try:
    from tmux_helper import capture_output, send_keys, session_exists, get_agent_runtime_state
except ImportError:
    def capture_output(agent_id, lines=100):
        return None

    def send_keys(agent_id, message, **kwargs):
        _ = kwargs
        return False

    def session_exists(agent_id):
        return False

    def get_agent_runtime_state(agent_id, launcher=""):
        _ = launcher
        return {'state': 'unknown'}

# get_agent_id is a simple function - define it locally to avoid circular import
def get_agent_id(agent_config):
    """Extract agent ID from config (e.g., EMP_0001 -> emp-0001)."""
    file_id = agent_config.get('file_id', '')
    if not file_id:
        name = agent_config.get('name', '')
        # Extract from name if it contains the ID
        # Common patterns: EMP_0001, emp-0001, etc.
        import re
        match = re.search(r'EMP[_-]?\d+', name, re.IGNORECASE)
        if match:
            file_id = match.group(0)
    # Convert EMP_0001 -> emp-0001
    return file_id.lower().replace('_', '-') if file_id else file_id


def _format_duration(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    rem = seconds % 60
    return f"{minutes}m{rem:02d}s"


def persist_last_team_task(team_name: str, task: str) -> None:
    """Persist the last assigned task for a team for recovery/nudging."""
    state_dir = _REPO_ROOT / '.claude' / 'state' / 'team-assignments'
    state_dir.mkdir(parents=True, exist_ok=True)

    task_file = state_dir / f"{team_name}.md"
    timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')

    content = f"# Last team task: {team_name}\n\nUpdated: {timestamp}\n\n{task.strip()}\n"
    task_file.write_text(content, encoding='utf-8')


def get_agent_name(employee_id: str) -> str:
    """
    Resolve employee ID to agent name.

    Args:
        employee_id: Employee ID (e.g., 'EMP_0001')

    Returns:
        Agent name (e.g., 'dev') or employee_id if not found
    """
    config = resolve_agent(employee_id, agents_dir=_AGENTS_DIR)
    if config:
        return config.get('name', employee_id)
    return employee_id


def cmd_list(args):
    """List all teams."""
    import json
    all_teams = list_all_teams()

    # JSON output for programmatic consumption
    if args.json:
        teams_data = []
        for team_name, config in sorted(all_teams.items()):
            lead_id = get_lead_agent_id(config)
            members = get_team_members(config)

            # Extract member employee IDs for easy access
            member_ids = [m.get('employee_id') for m in members]

            team_info = {
                'name': team_name,
                'enabled': config.get('enabled', True),
                'description': config.get('description', ''),
                'lead_agent_id': lead_id,
                'lead_agent_name': get_agent_name(lead_id) if lead_id else None,
                'working_directory': get_team_working_directory(config),
                'member_ids': member_ids,
                'members': members,
            }
            teams_data.append(team_info)

        print(json.dumps(teams_data, indent=2))
        return

    # Human-readable output
    print("📋 Teams:")
    print()

    if not all_teams:
        teams_dir = get_teams_dir()
        print(f"  No teams configured in {teams_dir}/")
        print()
        print("  Create a team by adding a TEAM_NAME.md file to teams/")
        return

    for team_name, config in sorted(all_teams.items()):
        # Check if team is disabled
        is_enabled = config.get('enabled', True)
        status_icon = "" if is_enabled else "⛔ Disabled"

        if status_icon:
            print(f"{status_icon} 📦 {team_name}")
        else:
            print(f"📦 {team_name}")
        print(f"   Description: {config.get('description', 'No description')}")

        lead_id = get_lead_agent_id(config)
        lead_name = get_agent_name(lead_id) if lead_id else "N/A"
        print(f"   Lead Agent: {lead_id} ({lead_name})")

        wd = get_team_working_directory(config)
        if wd:
            print(f"   Working Dir: {wd}")

        members = get_team_members(config)
        if members:
            member_str = ', '.join([f"{m['employee_id']}({m.get('role', 'member')})" for m in members])
            print(f"   Members: {member_str}")

        print()


def cmd_show(args):
    """Show detailed team information."""
    team = resolve_team(args.team)

    if not team:
        print(f"❌ Team not found: {args.team}")
        all_teams = list_all_teams()
        if all_teams:
            print("   Available teams:")
            for name in all_teams.keys():
                print(f"   - {name}")
        return 1

    # Validate config
    errors = validate_team_config(team)
    if errors:
        print(f"⚠️  Team configuration has errors:")
        for error in errors:
            print(f"   - {error}")
        print()

    print(f"📦 Team: {team['name']}")
    print(f"{'=' * 60}")
    print(f"Description: {team.get('description', 'No description')}")

    lead_id = get_lead_agent_id(team)
    lead_name = get_agent_name(lead_id) if lead_id else "N/A"
    print(f"Lead Agent: {lead_id} ({lead_name})")
    print()

    # Members
    members = get_team_members(team)
    if members:
        print("Members:")
        for member in members:
            emp_id = member.get('employee_id', 'unknown')
            agent_name = get_agent_name(emp_id)
            role = member.get('role', 'member')
            lead_mark = " 👑" if emp_id == lead_id else ""
            print(f"  - {emp_id} ({agent_name}) - {role}{lead_mark}")
    else:
        print("No members defined")

    # Team body (workflow, documentation)
    body = get_team_body(team)
    if body:
        print()
        print("Team Documentation:")
        print("-" * 60)
        print(body)

    return 0


def cmd_status(args):
    """Show status of all team members (running/stopped)."""
    team = resolve_team(args.team)

    if not team:
        print(f"❌ Team not found: {args.team}")
        return 1

    # Check if team is disabled
    is_enabled = team.get('enabled', True)
    if not is_enabled:
        print(f"⛔ Team '{team['name']}' is disabled")
        print(f"   Config: {team.get('_file', 'teams/' + team['_file_name'] + '.md')}")
        print(f"   To enable: Set 'enabled: true' in the team config")
        return 1

    print(f"📊 Team Status: {team['name']}")
    print(f"{'=' * 60}")

    members = get_team_members(team)
    lead_id = get_lead_agent_id(team)

    for member in members:
        emp_id = member.get('employee_id', 'unknown')
        agent_name = get_agent_name(emp_id)
        role = member.get('role', 'member')
        lead_mark = " 👑" if emp_id == lead_id else ""

        # Check if running and surface best-effort runtime state.
        agent_config = resolve_agent(emp_id, agents_dir=_AGENTS_DIR)
        is_running = False
        runtime_state = None

        if agent_config:
            # Check if agent is disabled
            is_enabled = agent_config.get('enabled', True)
            if not is_enabled:
                print(f"⛔ Disabled {emp_id} ({agent_name}) - {role}{lead_mark}")
                continue

            agent_id = get_agent_id(agent_config)
            is_running = session_exists(agent_id)

            if is_running:
                launcher = agent_config.get('launcher', '')
                runtime_state = get_agent_runtime_state(agent_id, launcher=launcher)

        if not is_running:
            print(f"⭕ Stopped {emp_id} ({agent_name}) - {role}{lead_mark}")
            continue

        state = (runtime_state or {}).get('state')
        elapsed_seconds = (runtime_state or {}).get('elapsed_seconds')
        reason = (runtime_state or {}).get('reason')

        suffix = ""
        if state in ("busy", "stuck"):
            if isinstance(elapsed_seconds, int):
                suffix = f" ({state} {_format_duration(elapsed_seconds)})"
            else:
                suffix = f" ({state})"
        elif state == "blocked":
            suffix = " (blocked: approval/user input)"
        elif state == "error":
            suffix = f" (error: {reason})" if reason else " (error)"
        elif state == "idle":
            suffix = " (idle)"

        print(f"✅ Running{suffix} {emp_id} ({agent_name}) - {role}{lead_mark}")

    return 0


def cmd_assign(args):
    """Assign task to a team's lead agent for coordination."""
    team = resolve_team(args.team)

    if not team:
        print(f"❌ Team not found: {args.team}")
        return 1

    # Check if team is disabled
    is_enabled = team.get('enabled', True)
    if not is_enabled:
        print(f"⚠️  Team '{team['name']}' is disabled")
        print(f"   Config: {team.get('_file', 'teams/' + team['_file_name'] + '.md')}")
        print(f"   To enable: Set 'enabled: true' in the team config")
        return 1

    # Read task
    if args.task_file:
        try:
            with open(args.task_file, 'r', encoding='utf-8') as f:
                task = f.read()
        except FileNotFoundError:
            print(f"❌ Task file not found: {args.task_file}")
            return 1
    else:
        task = sys.stdin.read()

    if not task.strip():
        print("❌ Task cannot be empty")
        print("   Provide task via stdin or --task-file")
        return 1

    # Persist the raw task so a monitor can re-assign if the team stops before completion.
    try:
        persist_last_team_task(team['name'], task)
    except Exception:
        # Persistence is best-effort; assignment should still proceed.
        pass

    # Get lead agent
    lead_id = get_lead_agent_id(team)
    if not lead_id:
        print("❌ Team has no lead_agent configured")
        return 1

    # Get team working directory (overrides agent's working_directory)
    team_wd = get_team_working_directory(team)

    # Build task message with team context
    members = get_team_members(team)
    body = get_team_body(team)

    task_message = f"""# Team Task Assignment

You are the **Lead Agent** for the **{team['name']}** team.

## Team Configuration
- **Lead Agent**: {lead_id} ({get_agent_name(lead_id)})
- **Team Working Directory**: {team_wd or 'Use agent default'}
- **Team Members**:
"""

    for member in members:
        emp_id = member.get('employee_id', 'unknown')
        agent_name = get_agent_name(emp_id)
        role = member.get('role', 'member')
        lead_mark = " (lead)" if emp_id == lead_id else ""
        task_message += f"  - {emp_id} ({agent_name}) - {role}{lead_mark}\n"

    # Include team body (workflow documentation)
    if body:
        task_message += f"""
## Team Workflow & Documentation

{body}
"""

    team_skills = team.get('skills', []) or []
    if team_skills:
        loaded_skills = []
        missing_skills = []

        for skill_name in team_skills:
            try:
                content = _read_skill_md(skill_name, _REPO_ROOT)
                content = content.strip()
            except Exception:
                missing_skills.append(skill_name)
                continue

            if content:
                loaded_skills.append(f"### {skill_name}\n\n{content}")

        if missing_skills:
            print(f"⚠️  Missing team skills: {', '.join(missing_skills)}")

        if loaded_skills:
            task_message += "\n## Team Skills (Loaded for this task)\n\n"
            task_message += "\n\n---\n\n".join(loaded_skills)
            task_message += "\n"

    task_message += f"""

## Your Responsibilities
1. Analyze the task requirements
2. Follow the team workflow when coordinating with members
3. Ensure quality and completeness
4. Report back with final results

## Session Recovery (If you were restarted / new session)
- Before doing any new work, inspect the repo state:
  - `git status -sb`
  - `git branch --show-current`
  - `git log -10 --oneline --decorate`
- If there is already a WIP branch/commits for this task, continue on that branch (do NOT create a new branch).
- If an open PR already exists for your current branch, continue pushing commits to that PR (do NOT create a new PR).
  - Example:
    - `BRANCH="$(git branch --show-current)"`
    - `gh pr list --state open --head "$BRANCH" --json number,url,title,headRefName --limit 20`
- If `gh` is unavailable/not authenticated, still avoid creating a duplicate PR: report the current branch + last commits and ask for human help to locate the existing PR.

## PR Hygiene (One PR per Issue)
- If this task references a GitHub Issue (e.g., `Issue #123`), you MUST avoid creating multiple concurrent PRs for the same issue.
- Before creating a new PR, search for an existing open PR that already references that issue.
  - Example (run inside the repo):
    - `ISSUE_NUMBER=123`
    - `gh pr list --state open --search "#$ISSUE_NUMBER" --json number,url,title,headRefName --limit 20`
    - If a matching PR exists: `gh pr checkout <PR_NUMBER>` and push commits to that branch instead of opening a new PR.
- If you accidentally created a duplicate PR for the same issue, close the newest duplicate and continue on the original PR (unless the original is explicitly abandoned).

## Task
{task}

---
Please coordinate this task with your team and report back when complete.
"""

    # Use agent-manager to assign task to lead agent
    import subprocess

    # Find agent-manager script (installed location; do not assume repo layout).
    agent_manager = None
    if _AGENT_MANAGER_SCRIPTS_DIR:
        candidate = _AGENT_MANAGER_SCRIPTS_DIR / 'main.py'
        if candidate.exists():
            agent_manager = candidate

    if not agent_manager:
        # Try to use via python module import
        print(f"⚠️  agent-manager not found, attempting direct assignment...")

        # Try direct tmux send
        agent_config = resolve_agent(lead_id, agents_dir=_AGENTS_DIR)
        if agent_config:
            agent_id = get_agent_id(agent_config)
            if session_exists(agent_id):
                send_keys(agent_id, task_message, send_enter=True)
                print(f"✅ Task assigned to {team['name']} team")
                print(f"   Lead Agent: {lead_id} ({get_agent_name(lead_id)})")
                print(f"   Monitor: tmux attach -t agent-{agent_id}")
                return 0
            else:
                print(f"⚠️  Lead agent '{lead_id}' is not running")
                repo_local_claude = _REPO_ROOT / '.claude' / 'skills' / 'agent-manager' / 'scripts' / 'main.py'
                repo_local_agent = _REPO_ROOT / '.agent' / 'skills' / 'agent-manager' / 'scripts' / 'main.py'

                if repo_local_claude.exists():
                    hint = f"python3 {repo_local_claude}"
                elif repo_local_agent.exists():
                    hint = f"python3 {repo_local_agent}"
                else:
                    hint = "python3 ~/.claude/skills/agent-manager/scripts/main.py"
                print(f"   Start with: {hint} start {lead_id}")
                return 1
        else:
            print(f"❌ Lead agent '{lead_id}' not found")
            return 1

    # Start lead agent with team working directory if not running
    agent_config = resolve_agent(lead_id, agents_dir=_AGENTS_DIR)
    if agent_config:
        agent_session_id = get_agent_id(agent_config)
        if session_exists(agent_session_id):
            # Lead agent is already running
            if args.restore:
                # --restore (default): Continue with existing session
                print(f"✅ Using existing session for lead agent '{lead_id}' ({get_agent_name(lead_id)})")
                print()
            else:
                # --no-restore: Fail if session exists
                print(f"❌ Lead agent '{lead_id}' ({get_agent_name(lead_id)}) is already running")
                print(f"   Session: agent-{agent_session_id}")
                print()
                print(f"   To assign to the existing session, use --restore (default)")
                print(f"   To stop first: python3 {Path(__file__).name} stop {team['name']}")
                print(f"   Or: python3 ~/.claude/skills/agent-manager/scripts/main.py stop {lead_id}")
                return 1
        else:
            # Agent not running, start it with team working directory
            start_cmd = ['python3', str(agent_manager), 'start', lead_id]
            if team_wd:
                start_cmd.extend(['--working-dir', team_wd])

            print(f"⏳ Starting lead agent {lead_id}...")
            start_result = subprocess.run(start_cmd, capture_output=True, text=True)
            if start_result.returncode != 0:
                print(f"❌ Failed to start lead agent: {start_result.stderr}")
                return 1
            print(f"✅ Lead agent started")
            print()

    # Use agent-manager CLI to assign task
    result = subprocess.run(
        ['python3', str(agent_manager), 'assign', lead_id],
        input=task_message,
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        print(f"✅ Task assigned to {team['name']} team")
        print(f"   Lead Agent: {lead_id} ({get_agent_name(lead_id)})")
        if team_wd:
            print(f"   Working Dir: {team_wd}")
        print()
        print("Monitor team progress:")
        print(f"  python3 {Path(__file__).resolve()} monitor {team['name']}")
        return 0
    else:
        print(f"❌ Failed to assign task: {result.stderr}")
        return 1


def cmd_monitor(args):
    """Monitor all team members' output."""
    team = resolve_team(args.team)

    if not team:
        print(f"❌ Team not found: {args.team}")
        return 1

    members = get_team_members(team)

    if args.follow:
        import time

        print(f"📺 Following {team['name']} team output (Ctrl+C to stop)...")
        print()

        last_outputs = {}

        try:
            while True:
                for member in members:
                    emp_id = member.get('employee_id', 'unknown')

                    agent_config = resolve_agent(emp_id, agents_dir=_AGENTS_DIR)
                    if not agent_config:
                        continue

                    agent_id = get_agent_id(agent_config)
                    if not session_exists(agent_id):
                        continue

                    output = capture_output(agent_id, args.lines)
                    if output is None:
                        continue

                    agent_name = get_agent_name(emp_id)
                    output_key = f"{emp_id}_{agent_name}"

                    if output_key not in last_outputs or output != last_outputs[output_key]:
                        print(f"\n{'=' * 20} {emp_id} ({agent_name}) {'=' * 20}")
                        print(output)
                        last_outputs[output_key] = output

                time.sleep(3)
        except KeyboardInterrupt:
            print("\n\n⏹  Monitoring stopped")
    else:
        print(f"📺 {team['name']} team output (last {args.lines} lines):")
        print("=" * 60)

        for member in members:
            emp_id = member.get('employee_id', 'unknown')
            agent_name = get_agent_name(emp_id)

            agent_config = resolve_agent(emp_id, agents_dir=_AGENTS_DIR)
            if not agent_config:
                continue

            agent_id = get_agent_id(agent_config)
            is_running = session_exists(agent_id)

            print(f"\n{'─' * 20} {emp_id} ({agent_name}) ({'Running' if is_running else 'Stopped'}) {'─' * 20}")

            if is_running:
                output = capture_output(agent_id, args.lines)
                if output:
                    print(output)
                else:
                    print("(no output)")
            else:
                print("(not running)")

    return 0


def cmd_create(args):
    """Create a new team configuration file."""
    teams_dir = get_teams_dir()

    if not teams_dir.exists():
        teams_dir.mkdir(parents=True, exist_ok=True)
        print(f"✅ Created teams directory: {teams_dir}")

    team_file = teams_dir / f"{args.name}.md"

    if team_file.exists() and not args.force:
        print(f"❌ Team file already exists: {team_file}")
        print(f"   Use --force to overwrite")
        return 1

    # Build team configuration
    # members are employee IDs
    members_yaml = "\n".join([f"      - employee_id: {m}\n        role: member" for m in args.members])

    team_content = f"""---
name: {args.name}
description: {args.description}
lead_agent: {args.lead}
members:
{members_yaml}
---

# {args.name.upper()} TEAM

## Description
{args.description}

## Workflow

```mermaid
graph TD
    A[Lead receives task] --> B[Analyze requirements]
    B --> C[Assign work]
    C --> D[Members complete tasks]
    D --> E[Review results]
    E --> F[Lead reports completion]
```

### Coordination Process

1. **Lead Agent** ({args.lead}) receives task and analyzes requirements
2. Lead assigns work to team members based on their roles
3. Members complete their assigned tasks independently
4. Lead reviews results and ensures quality
5. Lead reports completion with final results

## Team Members

"""

    for member in args.members:
        agent_name = get_agent_name(member)
        role = "member"
        if member == args.lead:
            role = "team lead 👑"
        team_content += f"- **{member}** ({agent_name}): {role}\n"

    team_content += f"""
## Usage

Assign task to this team:
```bash
python3 .agent/skills/team-manager/scripts/main.py assign {args.name} <<EOF
Your task description here...
EOF
```

Monitor team progress:
```bash
python3 .agent/skills/team-manager/scripts/main.py monitor {args.name} --follow
```
"""

    with open(team_file, 'w', encoding='utf-8') as f:
        f.write(team_content)

    print(f"✅ Team created: {args.name}")
    print(f"   Configuration: {team_file}")
    print()
    print(f"Next steps:")
    print(f"  1. Review and edit the workflow in {team_file}")
    print(f"  2. Ensure agents are configured in agents/")
    print(f"  3. Assign a task: python3 {Path(__file__).resolve()} assign {args.name}")

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Team Manager - Manage teams and assign tasks",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s list                           List all teams
  %(prog)s show frontend                  Show team details (including workflow)
  %(prog)s status frontend                Show team member status
  %(prog)s assign frontend <<EOF          Assign task to team (auto-starts Lead)
  Implement the feature
  EOF
  %(prog)s assign frontend --no-restore   Fail if Lead agent already running
  %(prog)s monitor frontend --follow      Monitor team output (live)
  %(prog)s create backend --lead EMP_0001 \\
      --members EMP_0001 EMP_0002         Create new team (using employee IDs)
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # list command
    list_parser = subparsers.add_parser('list', help='List all teams')
    list_parser.add_argument('--json', action='store_true',
                            help='Output in JSON format for programmatic consumption')

    # show command
    show_parser = subparsers.add_parser('show', help='Show team details')
    show_parser.add_argument('team', help='Team name')

    # status command
    status_parser = subparsers.add_parser('status', help='Show team status')
    status_parser.add_argument('team', help='Team name')

    # assign command
    assign_parser = subparsers.add_parser('assign', help='Assign task to team')
    assign_parser.add_argument('team', help='Team name')
    assign_parser.add_argument('--task-file', '-f', help='Read task from file')
    assign_parser.add_argument('--restore', '-r', action='store_true', default=True,
                              help='Restore/reuse existing tmux session if Lead agent is already running (default: true)')
    assign_parser.add_argument('--no-restore', dest='restore', action='store_false',
                              help='Do not restore; require Lead agent to be stopped first')

    # monitor command
    monitor_parser = subparsers.add_parser('monitor', help='Monitor team output')
    monitor_parser.add_argument('team', help='Team name')
    monitor_parser.add_argument('--follow', '-f', action='store_true',
                               help='Follow output (like tail -f)')
    monitor_parser.add_argument('--lines', '-n', type=int, default=50,
                               help='Number of lines per agent (default: 50)')

    # create command
    create_parser = subparsers.add_parser('create', help='Create a new team')
    create_parser.add_argument('name', help='Team name (e.g., frontend, backend)')
    create_parser.add_argument('--lead', required=True,
                              help='Lead agent employee ID (e.g., EMP_0001)')
    create_parser.add_argument('--members', nargs='+', default=[],
                              help='Team member employee IDs')
    create_parser.add_argument('--description', '-d', default='Team description',
                              help='Team description')
    create_parser.add_argument('--force', action='store_true',
                              help='Overwrite existing team file')

    args = parser.parse_args()

    # Show help if no command
    if not args.command:
        parser.print_help()
        return 0

    # Route to appropriate handler
    handlers = {
        'list': cmd_list,
        'show': cmd_show,
        'status': cmd_status,
        'assign': cmd_assign,
        'monitor': cmd_monitor,
        'create': cmd_create,
    }

    handler = handlers.get(args.command)
    if handler:
        return handler(args)

    parser.print_help()
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:
        try:
            sys.stdout.close()
        finally:
            sys.exit(0)
