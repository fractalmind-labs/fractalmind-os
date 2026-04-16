#!/usr/bin/env python3
"""
Agent Status CLI - Employee attendance system for agents.

Monitors agent availability, quota status, and idle times.
Like an employee calendar showing who's available, working, or on 'vacation'.
"""

import argparse
import sys
import os
from pathlib import Path
from datetime import datetime, timezone

# Add agent-manager scripts to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'agent-manager' / 'scripts'))

try:
    from agent_config import list_all_agents, resolve_agent
except ImportError:
    print("❌ agent-manager not found. Please ensure it's installed.")
    sys.exit(1)

from status_detector import (
    detect_agent_state,
    AgentState,
    format_wait_time,
    format_idle_time
)


def get_all_agent_states() -> dict:
    """Get state of all agents."""
    all_agents = list_all_agents()
    states = {}

    for agent_name, config in all_agents.items():
        emp_id = config.get('file_id', 'UNKNOWN')
        state_info = detect_agent_state(emp_id, config)
        states[emp_id] = state_info

    return states


def format_state_icon(state: AgentState) -> str:
    """Get icon for agent state."""
    icons = {
        AgentState.WORKING: "✅",
        AgentState.IDLE: "⏸️",
        AgentState.QUOTA_EXHAUSTED: "⚠️",
        AgentState.ERROR: "❌",
        AgentState.STOPPED: "⭕"
    }
    return icons.get(state, "?")


def format_state_text(state: AgentState) -> str:
    """Get text for agent state."""
    texts = {
        AgentState.WORKING: "Work",
        AgentState.IDLE: "Idle",
        AgentState.QUOTA_EXHAUSTED: "429",
        AgentState.ERROR: "Err",
        AgentState.STOPPED: "Stop"
    }
    return texts.get(state, "???")


def cmd_calendar(args):
    """Display agent availability calendar."""
    states = get_all_agent_states()

    # Filter by state if specified
    if args.state:
        state_map = {
            'working': AgentState.WORKING,
            'idle': AgentState.IDLE,
            'quota-exhausted': AgentState.QUOTA_EXHAUSTED,
            'error': AgentState.ERROR,
            'stopped': AgentState.STOPPED
        }
        filter_state = state_map.get(args.state.lower())
        if filter_state:
            states = {
                emp_id: state
                for emp_id, state in states.items()
                if state['state'] == filter_state
            }

    # Filter running only if specified
    if args.running:
        states = {
            emp_id: state
            for emp_id, state in states.items()
            if state['state'] != AgentState.STOPPED
        }

    # Sort by agent ID
    sorted_states = sorted(states.items(), key=lambda x: x[0])

    # Print calendar
    now = datetime.now(timezone.utc)
    print(f"╔{'═'*60}╗")
    print(f"║  Agent Availability Calendar - {now.strftime('%Y-%m-%d %H:%M')}{' '*(20)}║")
    print(f"╠{'═'*60}╣")
    print("║ EMP    │ Agent Name              │ Status  │ Info            ║")
    print(f"╠{'═'*60}╣")

    for emp_id, state in sorted_states:
        icon = format_state_icon(state['state'])
        status_text = format_state_text(state['state'])

        # Build info column
        if state['state'] == AgentState.QUOTA_EXHAUSTED:
            wait_secs = state.get('wait_seconds', 0)
            info = f"~{format_wait_time(wait_secs)} until reset" if wait_secs > 0 else "Quota exhausted"
        elif state['state'] == AgentState.IDLE:
            idle_secs = state.get('idle_seconds', 0)
            info = format_idle_time(idle_secs)
        elif state['state'] == AgentState.ERROR:
            info = state.get('error', 'Unknown')[:20]
        elif state['state'] == AgentState.STOPPED:
            info = "-"
        else:
            info = "-"

        # Truncate name to fit
        name = state['name'][:22]

        print(f"║ {emp_id[-4:]} │ {name:<23} │ {icon} {status_text:<5} │ {info:<15} ║")

    print(f"╚{'═'*60}╝")

    # Print summary
    state_counts = {}
    for state in states.values():
        s = state['state']
        state_counts[s] = state_counts.get(s, 0) + 1

    summary_parts = []
    for s, count in state_counts.items():
        icon = format_state_icon(s)
        summary_parts.append(f"{count} {icon}")

    print(f"\nSummary: {' | '.join(summary_parts)}")

    # Provide recommendation
    idle_count = state_counts.get(AgentState.IDLE, 0)
    quota_count = state_counts.get(AgentState.QUOTA_EXHAUSTED, 0)

    if idle_count > 0:
        idle_agents = [emp_id for emp_id, s in states.items() if s['state'] == AgentState.IDLE]
        print(f"Recommendation: Assign tasks to {', '.join(idle_agents)}")

    if quota_count > 0:
        quota_agents = [emp_id for emp_id, s in states.items() if s['state'] == AgentState.QUOTA_EXHAUSTED]
        print(f"Avoid: {', '.join(quota_agents)} (quota exhausted)")

    return 0


def cmd_show(args):
    """Show detailed status of a specific agent."""
    # Resolve agent
    agent_config = resolve_agent(args.agent_id)

    if not agent_config:
        print(f"❌ Agent not found: {args.agent_id}")
        print("\nAvailable agents:")
        all_agents = list_all_agents()
        for agent_name, config in all_agents.items():
            emp_id = config.get('file_id', 'UNKNOWN')
            print(f"  - {emp_id} ({config.get('name', 'unknown')})")
        return 1

    emp_id = agent_config.get('file_id', args.agent_id)
    state_info = detect_agent_state(emp_id, agent_config)

    print(f"📊 Agent: {emp_id} ({state_info['name']})")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    # Status
    icon = format_state_icon(state_info['state'])
    status_text = state_info['state'].value.replace('-', ' ').title()
    print(f"Current Status: {icon} {status_text}\n")

    # Provider Configuration
    print("Provider Configuration:")
    launcher = agent_config.get('launcher', 'N/A')
    launcher_args = agent_config.get('launcher_args', [])
    print(f"  • Launcher: {launcher}")
    if launcher_args:
        print(f"  • Args: {', '.join(launcher_args)}")
    working_dir = agent_config.get('working_directory', 'N/A')
    print(f"  • Working Dir: {working_dir}\n")

    # State-specific details
    if state_info['state'] == AgentState.QUOTA_EXHAUSTED:
        print("Quota Details:")
        print(f"  • Error: {state_info.get('error', 'Unknown')}")
        if state_info.get('reset_time'):
            reset_time = state_info['reset_time']
            print(f"  • Reset Time: {reset_time.strftime('%Y-%m-%d %H:%M:%S')}")
            wait_secs = state_info.get('wait_seconds', 0)
            print(f"  • Wait Time: ~{format_wait_time(wait_secs)}")
        print()

    elif state_info['state'] == AgentState.IDLE:
        print("Idle Details:")
        idle_secs = state_info.get('idle_seconds', 0)
        print(f"  • Idle Duration: {format_idle_time(idle_secs)}")
        print(f"  • Status: Ready for new tasks\n")

    # Session Info
    print("Session Info:")
    print(f"  • Tmux Session: {state_info.get('session_name', 'N/A')}")
    if state_info['state'] != AgentState.STOPPED:
        print(f"  • Status: Running\n")
    else:
        print(f"  • Status: Not running\n")

    # Recommendations
    print("Recommendations:")
    if state_info['state'] == AgentState.QUOTA_EXHAUSTED:
        print("  ⏳ Wait for quota reset before assigning tasks")
        print("  🔄 Consider restarting agent after reset")
    elif state_info['state'] == AgentState.IDLE:
        print("  ✅ Ready to accept new tasks immediately")
    elif state_info['state'] == AgentState.WORKING:
        print("  ⚠️ Currently working - assign with caution")
    elif state_info['state'] == AgentState.STOPPED:
        print("  🚦 Start agent before assigning tasks:")
        print(f"     python3 .agent/skills/agent-manager/scripts/main.py start {emp_id}")
    elif state_info['state'] == AgentState.ERROR:
        print("  🔍 Check agent logs for details:")
        print(f"     tmux attach -t {state_info.get('session_name')}")

    return 0


def cmd_team(args):
    """Show team availability."""
    # Import team-manager
    repo_root = os.environ.get('REPO_ROOT', Path(__file__).resolve().parents[4])
    try:
        sys.path.insert(0, str(Path(repo_root) / '.agent' / 'skills' / 'team-manager' / 'scripts'))
        from team_config import resolve_team, get_team_members
    except ImportError:
        print("❌ team-manager not found. Cannot show team availability.")
        return 1

    team = resolve_team(args.team_name)
    if not team:
        print(f"❌ Team not found: {args.team_name}")
        print("\nAvailable teams:")
        # List teams from teams/ directory
        teams_dir = Path(os.environ.get('REPO_ROOT', '.')) / 'teams'
        if teams_dir.exists():
            for team_file in sorted(teams_dir.glob('*.md')):
                print(f"  - {team_file.stem}")
        return 1

    team_name = team['name']
    members = get_team_members(team)

    print(f"📦 {team_name} Team Availability")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    # Categorize members
    available = []
    idle = []
    working = []
    unavailable = []

    for member in members:
        emp_id = member.get('employee_id')
        if not emp_id:
            continue

        agent_config = resolve_agent(emp_id)
        if not agent_config:
            continue

        state_info = detect_agent_state(emp_id, agent_config)
        role = member.get('role', 'member')

        member_info = {
            'emp_id': emp_id,
            'name': state_info['name'],
            'role': role,
            'state': state_info
        }

        if state_info['state'] == AgentState.QUOTA_EXHAUSTED or state_info['state'] == AgentState.ERROR or state_info['state'] == AgentState.STOPPED:
            unavailable.append(member_info)
        elif state_info['state'] == AgentState.IDLE:
            idle.append(member_info)
        elif state_info['state'] == AgentState.WORKING:
            working.append(member_info)

    # Print categories
    if available or idle:
        print(f"✅ Available for Tasks: {len(idle)}")
        for m in idle:
            idle_secs = m['state'].get('idle_seconds', 0)
            print(f"   • {m['emp_id']} ({m['name']}) - {m['role']} - Idle {format_idle_time(idle_secs)}")
        print()

    if idle:
        print(f"⏸️ Idle but Available: {len(idle)}")
        for m in idle:
            idle_secs = m['state'].get('idle_seconds', 0)
            print(f"   • {m['emp_id']} ({m['name']}) - {m['role']} - {format_idle_time(idle_secs)}")
        print()

    if working:
        print(f"🔄 Currently Working: {len(working)}")
        for m in working:
            print(f"   • {m['emp_id']} ({m['name']}) - {m['role']}")
        print()

    if unavailable:
        print(f"❌ Unavailable: {len(unavailable)}")
        for m in unavailable:
            icon = format_state_icon(m['state']['state'])
            if m['state']['state'] == AgentState.QUOTA_EXHAUSTED:
                wait_secs = m['state'].get('wait_seconds', 0)
                print(f"   • {m['emp_id']} ({m['name']}) - {icon} Quota - {format_wait_time(wait_secs)}")
            elif m['state']['state'] == AgentState.STOPPED:
                print(f"   • {m['emp_id']} ({m['name']}) - {icon} Stopped")
            else:
                print(f"   • {m['emp_id']} ({m['name']}) - {icon} Error")
        print()

    # Summary
    total_members = len(members)
    available_count = len(idle)
    working_count = len(working)

    print(f"💡 Team Capacity: {total_members} total | {available_count} available | {working_count} working")

    if available_count > 0:
        idle_members = [m['emp_id'] for m in idle]
        print(f"💡 Can accept {available_count} new task(s)")
        print(f"💡 Priority: {', '.join(idle_members)}")

    return 0


def cmd_suggest(args):
    """Suggest agents for task assignment."""
    states = get_all_agent_states()

    # Filter available agents
    available = []
    for emp_id, state in states.items():
        if state['state'] in [AgentState.IDLE, AgentState.WORKING]:
            available.append((emp_id, state))

    # Sort by priority (idle first, then working)
    def sort_key(item):
        emp_id, state = item
        if state['state'] == AgentState.IDLE:
            # Sort by idle time (longer idle = higher priority)
            return (0, -state.get('idle_seconds', 0))
        else:
            return (1, 0)

    available.sort(key=sort_key)

    print(f"💡 Task Assignment Recommendations")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    if args.task_type:
        print(f"Task Type: {args.task_type.title()}\n")

    # Show top recommendations
    print("Top Recommendations:")

    for i, (emp_id, state) in enumerate(available[:5], 1):
        icon = format_state_icon(state['state'])
        status_text = format_state_text(state['state'])

        medals = ["🥇", "🥈", "🥉", "  ", "  "]
        medal = medals[i-1] if i <= len(medals) else "  "

        print(f"{medal} {emp_id} ({state['name']})")
        print(f"   • Status: {icon} {status_text}", end="")

        if state['state'] == AgentState.IDLE:
            idle_secs = state.get('idle_seconds', 0)
            print(f" - {format_idle_time(idle_secs)}")
        else:
            print(" - Active task")

        # Get agent config for skills
        agent_config = resolve_agent(emp_id)
        if agent_config:
            skills = agent_config.get('skills', [])
            if skills:
                print(f"   • Skills: {', '.join(skills[:3])}")
                if len(skills) > 3:
                    print(f"              {', '.join(skills[3:])}")

        print()

    # Show unavailable agents
    unavailable = [
        (emp_id, state)
        for emp_id, state in states.items()
        if state['state'] in [AgentState.QUOTA_EXHAUSTED, AgentState.ERROR, AgentState.STOPPED]
    ]

    if unavailable:
        print("❌ Avoid (Unavailable):")
        for emp_id, state in unavailable:
            icon = format_state_icon(state['state'])
            if state['state'] == AgentState.QUOTA_EXHAUSTED:
                wait_secs = state.get('wait_seconds', 0)
                print(f"  • {emp_id} - {icon} Quota exhausted (~{format_wait_time(wait_secs)})")
            elif state['state'] == AgentState.STOPPED:
                print(f"  • {emp_id} - {icon} Stopped")
            else:
                print(f"  • {emp_id} - {icon} Error")
        print()

    # Suggest command
    if available:
        top_agent = available[0][0]
        print(f"💡 Assignment Command:")
        print(f"   python3 .agent/skills/agent-manager/scripts/main.py assign {top_agent} <<EOF")
        print(f"   Your task here...")
        print(f"   EOF")

    return 0


def main():
    parser = argparse.ArgumentParser(
        description='Agent availability and quota monitoring system',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # calendar command
    calendar_parser = subparsers.add_parser('calendar', help='Show agent availability calendar')
    calendar_parser.add_argument('--running', action='store_true', help='Show only running agents')
    calendar_parser.add_argument('--state', choices=['working', 'idle', 'quota-exhausted', 'error', 'stopped'],
                                help='Filter by state')
    calendar_parser.set_defaults(func=cmd_calendar)

    # show command
    show_parser = subparsers.add_parser('show', help='Show detailed agent status')
    show_parser.add_argument('agent_id', help='Agent employee ID (e.g., EMP_0007)')
    show_parser.set_defaults(func=cmd_show)

    # team command
    team_parser = subparsers.add_parser('team', help='Show team availability')
    team_parser.add_argument('team_name', help='Team name (e.g., polymarket-quant)')
    team_parser.set_defaults(func=cmd_team)

    # suggest command
    suggest_parser = subparsers.add_parser('suggest', help='Get task assignment suggestions')
    suggest_parser.add_argument('--task-type', choices=['development', 'review', 'coordination', 'analysis', 'testing'],
                               help='Type of task to assign')
    suggest_parser.set_defaults(func=cmd_suggest)

    # watch command (placeholder)
    watch_parser = subparsers.add_parser('watch', help='Watch status changes (not yet implemented)')
    watch_parser.add_argument('--follow', action='store_true', help='Continuous monitoring')
    watch_parser.add_argument('--interval', type=int, default=30, help='Refresh interval in seconds')
    watch_parser.set_defaults(func=lambda args: (print("⚠️  Watch command not yet implemented"), 1))

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
