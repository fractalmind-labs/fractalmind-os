#!/usr/bin/env python3
"""
Agent Manager - CLI for managing employee agents in tmux sessions.

A simple alternative to CAO using only tmux + Python.
Sessions are named: agent-{agent_id} where agent_id is file_id in lowercase (e.g., emp-0001)
"""

import argparse
import json
import os
import shlex
import sys
import time
from pathlib import Path

# Add scripts directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from agent_config import (
    resolve_agent,
    list_all_agents,
    load_skills,
    build_system_prompt,
    get_launcher_command,
    get_agent_schedule,
    get_schedule_task,
    parse_duration,
)

from repo_root import get_repo_root
from tmux_helper import (
    check_tmux,
    list_sessions,
    session_exists,
    start_session,
    stop_session,
    capture_output,
    send_keys,
    get_session_info,
    wait_for_prompt,
    inject_system_prompt,
    wait_for_agent_ready,
    is_agent_busy,
    get_agent_runtime_state,
)

# Import provider system (lives at .agent/skills/agent-manager/providers)
sys.path.insert(0, str(Path(__file__).parent.parent))
from providers import (
    get_system_prompt_mode,
    get_system_prompt_flag,
    get_mcp_config_mode,
    get_mcp_config_flag,
    resolve_launcher_command,
)


def write_system_prompt_file(repo_root: Path, agent_id: str, system_prompt: str) -> Path:
    state_dir = repo_root / '.claude' / 'state' / 'system-prompts'
    state_dir.mkdir(parents=True, exist_ok=True)
    prompt_file = state_dir / f"{agent_id}.txt"
    prompt_file.write_text(system_prompt + "\n", encoding='utf-8')
    return prompt_file


def build_mcp_config_json(agent_config: dict) -> str:
    """Build MCP config JSON for provider CLIs that support it.

    Agent frontmatter uses `mcps` (a mapping of server_name -> server_config).
    For Claude Code, we pass a JSON object with `mcpServers`.
    """
    mcps = agent_config.get('mcps')
    if mcps is None:
        mcps = {}

    if not isinstance(mcps, dict):
        raise ValueError("Invalid 'mcps' in agent config (expected a mapping)")

    if not mcps:
        return ""

    payload = {"mcpServers": mcps}
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def cleanup_old_logs(repo_root: Path, days: int = 7) -> int:
    """Remove log files older than specified days.

    Args:
        repo_root: Repository root path
        days: Number of days to retain logs (default: 7)

    Returns:
        Number of log files removed
    """
    log_dir = repo_root / '.crontab_logs'
    if not log_dir.exists():
        # Create log directory if it doesn't exist
        log_dir.mkdir(parents=True, exist_ok=True)
        return 0

    cutoff = time.time() - (days * 86400)
    removed = 0

    for log_file in log_dir.glob("*.log"):
        try:
            if log_file.stat().st_mtime < cutoff:
                log_file.unlink()
                removed += 1
        except (OSError, IOError):
            # Silently skip files that can't be removed
            pass

    return removed


def build_start_command(working_dir: str, launcher: str, launcher_args: list[str]) -> str:
    # Cron/tmux often runs with a minimal PATH; include common user-local bin dirs so
    # launchers like `ccc` can find `claude` (usually installed under ~/.local/bin).
    env_part = 'export PATH="$HOME/.local/bin:$HOME/bin:$PATH"'
    cd_part = f"cd {shlex.quote(working_dir)}"
    cmd_parts = [launcher] + list(launcher_args or [])
    exec_part = " ".join(shlex.quote(str(part)) for part in cmd_parts if part is not None and str(part) != "")
    return f"{env_part} && {cd_part} && {exec_part}".strip()


def get_agent_id(config: dict) -> str:
    """Get agent_id from config (file_id in lowercase, with hyphens)."""
    file_id = config.get('file_id', 'UNKNOWN')
    return file_id.lower().replace('_', '-')


def cmd_list(args):
    """List all agents (configured and running)."""
    all_agents = list_all_agents()
    running_sessions = set(list_sessions())

    print("📋 Agents:")
    print()

    if not all_agents:
        print("  No agents configured in agents/")
        return

    for file_id, config in sorted(all_agents.items(), key=lambda item: item[0]):
        agent_name = config.get('name') or file_id
        agent_id = get_agent_id(config)
        is_running = agent_id in running_sessions
        is_enabled = config.get('enabled', True)

        # Skip if --running and not active
        if args.running and not is_running:
            continue

        # Status indicator - show: agent-emp-0001(dev)
        if is_running:
            status = "✅ Running"
            session_info = get_session_info(agent_id)
            if session_info:
                print(f"{status} {session_info['session']}({agent_name})")
            else:
                print(f"{status} agent-{agent_id}({agent_name})")
        elif not is_enabled:
            status = "⛔ Disabled"
            print(f"{status} agent-{agent_id}({agent_name})")
            print(f"   Description: {config.get('description', 'No description')}")
            print(f"   Working Dir: {config.get('working_directory', 'N/A')}")
            print()
            continue
        else:
            status = "⭕ Stopped"
            print(f"{status} agent-{agent_id}({agent_name})")

        print(f"   Description: {config.get('description', 'No description')}")
        print(f"   Working Dir: {config.get('working_directory', 'N/A')}")

        skills = config.get('skills', [])
        if skills:
            print(f"   Skills: {', '.join(skills)}")

        print()


def cmd_start(args):
    """Start an agent in tmux session."""
    # Check tmux
    if not check_tmux():
        print("❌ tmux is not installed. Install with: apt install tmux")
        return 1

    # Resolve agent
    agent_config = resolve_agent(args.agent)
    if not agent_config:
        print(f"❌ Agent not found: {args.agent}")
        print("   Available agents:")
        all_agents = list_all_agents()
        for file_id, config in sorted(all_agents.items(), key=lambda item: item[0]):
            name = config.get('name') or file_id
            agent_id = get_agent_id(config)
            print(f"   - {file_id} ({name}) (agent-{agent_id})")
        return 1

    agent_name = agent_config['name']
    agent_id = get_agent_id(agent_config)
    agent_file_id = agent_config.get('file_id', args.agent)

    # Check if agent is disabled
    if not agent_config.get('enabled', True):
        agent_file_path = agent_config.get('_file_path', f'agents/{agent_file_id}.md')
        print(f"⚠️  Agent '{agent_name}' is disabled")
        print(f"   Config: {agent_file_path}")
        print(f"   To enable: Set 'enabled: true' in the agent config")
        return 1

    # Check if already running
    if session_exists(agent_id):
        session_name = f"agent-{agent_id}"
        print(f"⚠️  Agent '{agent_name}' is already running")
        print(f"   Session: {session_name}({agent_name})")
        print()
        print(f"   To stop first: python3 {Path(__file__).name} stop {agent_file_id}")
        print(f"   Or attach directly: tmux attach -t {session_name}")
        return 1

    # Override working directory if specified
    working_dir = args.working_dir or agent_config.get('working_directory')
    if not working_dir:
        print("❌ No working directory specified")
        return 1

    repo_root = get_repo_root()
    skills_dir = repo_root / '.agent' / 'skills'

    # Build launcher command
    launcher = resolve_launcher_command(agent_config.get('launcher', ''))
    launcher_args = agent_config.get('launcher_args', [])

    # Build system prompt early so supported providers can receive it at process start.
    system_prompt = build_system_prompt(agent_config, repo_root=repo_root, skills_dir=skills_dir)
    system_prompt_mode = get_system_prompt_mode(launcher)
    system_prompt_flag = get_system_prompt_flag(launcher)

    # Build MCP config early so supported providers can receive it at process start.
    mcp_config_mode = get_mcp_config_mode(launcher)
    mcp_config_flag = get_mcp_config_flag(launcher)
    try:
        mcp_config_json = build_mcp_config_json(agent_config)
    except ValueError as e:
        print(f"❌ {e}")
        return 1

    use_cli_system_prompt = bool(system_prompt and system_prompt_mode == 'cli_append' and system_prompt_flag)
    command = build_start_command(working_dir, launcher, launcher_args)

    if use_cli_system_prompt:
        prompt_file = write_system_prompt_file(repo_root, agent_id, system_prompt)
        command = f"{command} {shlex.quote(system_prompt_flag)} \"$(cat {shlex.quote(str(prompt_file))})\""

    # Inject MCP config if provider supports it.
    if mcp_config_json:
        if mcp_config_mode == 'cli_json' and mcp_config_flag:
            command = f"{command} {shlex.quote(mcp_config_flag)} {shlex.quote(mcp_config_json)}"
        else:
            print(f"⚠️  MCP config present but not supported for launcher '{launcher}' - ignoring")

    # Start session
    if not start_session(agent_id, command):
        print(f"❌ Failed to start agent '{agent_name}'")
        return 1

    session_name = f"agent-{agent_id}"
    print(f"✅ Agent '{agent_name}' started")
    print(f"   Session: {session_name}({agent_name})")
    print(f"   Working Dir: {working_dir}")
    print()

    launcher = resolve_launcher_command(agent_config.get('launcher', ''))

    # Step 1: Wait for CLI to be ready
    print(f"⏳ Waiting for CLI to be ready...")
    if not wait_for_prompt(agent_id, launcher, timeout=30):
        print(f"⚠️  Timeout waiting for CLI prompt")
        # If the underlying command exited immediately (e.g., PATH/launcher issues),
        # the tmux session may have already disappeared.
        if not session_exists(agent_id):
            print(f"❌ Agent session exited during startup")
            return 1
        if use_cli_system_prompt:
            print(f"   Continuing: system prompt injected via {system_prompt_flag}; CLI may still be starting...")
        else:
            if system_prompt:
                print(f"   System prompt not injected. Agent may still be starting...")
            return 1

    if system_prompt:
        if use_cli_system_prompt:
            print(f"✅ CLI ready (system prompt injected via {system_prompt_flag})")
        else:
            print(f"✅ CLI ready, injecting system prompt via tmux...")

            # Step 2 (fallback): Inject system prompt using tmux buffer
            if not inject_system_prompt(agent_id, system_prompt):
                print(f"❌ Failed to inject system prompt")
                return 1

            skills = agent_config.get('skills', [])
            if skills:
                print(f"   System prompt injected ({len(system_prompt)} chars, {len(skills)} skills)")
            else:
                print(f"   System prompt injected ({len(system_prompt)} chars)")
    else:
        print(f"ℹ️  No system prompt configured for this agent")

    # Step 3: Wait for agent to be ready
    print(f"⏳ Waiting for agent to be ready...")
    if wait_for_agent_ready(agent_id, launcher, timeout=45):
        print(f"✅ Agent is ready!")
    else:
        print(f"⚠️  Agent readiness timeout, but may still be processing...")

    # Final sanity check: ensure the session is still alive before returning success.
    if not session_exists(agent_id):
        print(f"❌ Agent session exited during startup")
        return 1

    print()
    print(f"Attach with: tmux attach -t {session_name}")
    print(f"Monitor with: python3 {Path(__file__).name} monitor {agent_file_id}")

    return 0


def cmd_stop(args):
    """Stop a running agent."""
    if not check_tmux():
        print("❌ tmux is not installed")
        return 1

    # Resolve agent
    agent_config = resolve_agent(args.agent)
    if not agent_config:
        print(f"❌ Agent not found: {args.agent}")
        return 1

    agent_name = agent_config['name']
    agent_id = get_agent_id(agent_config)

    # Check if running
    if not session_exists(agent_id):
        print(f"⚠️  Agent '{agent_name}' is not running")
        return 1

    # Stop session
    if not stop_session(agent_id):
        print(f"❌ Failed to stop agent '{agent_name}'")
        return 1

    session_name = f"agent-{agent_id}"
    print(f"✅ Agent '{agent_name}' stopped")
    print(f"   Session {session_name}({agent_name}) terminated")
    return 0


def cmd_monitor(args):
    """Monitor agent output."""
    if not check_tmux():
        print("❌ tmux is not installed")
        return 1

    # Resolve agent
    agent_config = resolve_agent(args.agent)
    if not agent_config:
        print(f"❌ Agent not found: {args.agent}")
        return 1

    agent_name = agent_config['name']
    agent_id = get_agent_id(agent_config)

    if args.follow:
        # Follow mode (like tail -f)
        session_name = f"agent-{agent_id}"
        print(f"📺 Following output for {session_name}({agent_name}) (Ctrl+C to stop)...")
        print()

        last_output = ""
        try:
            while True:
                output = capture_output(agent_id, args.lines)
                if output is None:
                    print(f"⚠️  Agent '{agent_name}' is not running")
                    return 1

                if output != last_output:
                    # Print only new content
                    if last_output:
                        new_lines = output[len(last_output):]
                        print(new_lines, end='')
                    else:
                        print(output, end='')
                    last_output = output

                time.sleep(2)
        except KeyboardInterrupt:
            print("\n\n⏹  Monitoring stopped")
    else:
        # Static snapshot
        output = capture_output(agent_id, args.lines)
        if output is None:
            print(f"⚠️  Agent '{agent_name}' is not running")
            return 1

        session_name = f"agent-{agent_id}"
        print(f"📺 Last {args.lines} lines from {session_name}({agent_name}):")
        print("=" * 60)
        print(output)
        print("=" * 60)

    return 0


def cmd_send(args):
    """Send message to agent."""
    if not check_tmux():
        print("❌ tmux is not installed")
        return 1

    # Resolve agent
    agent_config = resolve_agent(args.agent)
    if not agent_config:
        print(f"❌ Agent not found: {args.agent}")
        return 1

    agent_name = agent_config['name']
    agent_id = get_agent_id(agent_config)

    if not session_exists(agent_id):
        print(f"⚠️  Agent '{agent_name}' is not running")
        print(f"   Start with: python3 {Path(__file__).name} start {agent_config.get('file_id', agent_name)}")
        return 1

    # Send message
    if not send_keys(agent_id, args.message, send_enter=args.send_enter):
        print(f"❌ Failed to send message to {agent_name}")
        return 1

    print(f"✅ Message sent to {agent_name}")
    print(f"   Message: {args.message}")
    print()
    print(f"Monitor response: python3 {Path(__file__).name} monitor {agent_name}")
    return 0


def cmd_assign(args):
    """Assign task to agent."""
    if not check_tmux():
        print("❌ tmux is not installed")
        return 1

    # Resolve agent
    agent_config = resolve_agent(args.agent)
    if not agent_config:
        print(f"❌ Agent not found: {args.agent}")
        return 1

    agent_name = agent_config['name']
    agent_id = get_agent_id(agent_config)

    # Read task
    if args.task_file:
        try:
            with open(args.task_file, 'r') as f:
                task = f.read()
        except FileNotFoundError:
            print(f"❌ Task file not found: {args.task_file}")
            return 1
    else:
        # Read from stdin
        task = sys.stdin.read()

    if not task.strip():
        print("❌ Task cannot be empty")
        print("   Provide task via stdin or --task-file")
        return 1

    # Start agent if not running
    if not session_exists(agent_id):
        print(f"⚠️  Agent {agent_name} is not running. Starting...")

        # Build start args
        start_args = argparse.Namespace(
            agent=args.agent,
            working_dir=None
        )

        if cmd_start(start_args) != 0:
            return 1

        print()
        time.sleep(3)  # Give Claude Code time to start

    # Send task
    task_message = f"# Task Assignment\n\n{task}"
    if not send_keys(agent_id, task_message, send_enter=True):
        print(f"❌ Failed to assign task to {agent_name}")
        return 1

    print(f"✅ Task assigned to {agent_name}")
    print()
    print(f"Monitor progress: python3 {Path(__file__).name} monitor {agent_name} --follow")
    return 0


def cmd_schedule(args):
    """Handle schedule subcommands."""
    from schedule_helper import list_schedules_formatted, sync_crontab

    if args.schedule_command == 'list':
        print(list_schedules_formatted())
        return 0

    elif args.schedule_command == 'sync':
        result = sync_crontab(dry_run=args.dry_run)

        if args.dry_run:
            print("🔍 Dry run - would sync the following to crontab:")
            print()
            if result['content']:
                print(result['content'])
            else:
                print("(no schedules configured)")
            return 0

        if result['success']:
            print(f"✅ Crontab synced successfully")
            entries = result.get('entries', 0)
            added = result.get('added', 0)
            removed = result.get('removed', 0)
            print(f"   {entries} schedule entries configured")
            if added or removed:
                print(f"   Changes: +{added} -{removed}")
        else:
            print(f"❌ Failed to sync crontab")
            return 1

        return 0

    elif args.schedule_command == 'run':
        return cmd_schedule_run(args)

    else:
        print(f"Unknown schedule command: {args.schedule_command}")
        return 1


def cmd_schedule_run(args):
    """Run a scheduled job for an agent."""
    if not check_tmux():
        print("❌ tmux is not installed")
        return 1

    # Get schedule config
    schedule = get_agent_schedule(args.agent, args.job)
    if not schedule:
        print(f"❌ Schedule '{args.job}' not found for agent '{args.agent}'")
        return 1

    agent_config = schedule['_agent_config']
    agent_name = agent_config['name']
    agent_id = get_agent_id(agent_config)

    # Check if agent is disabled (early exit to avoid failed start attempts)
    if not agent_config.get('enabled', True):
        agent_file_id = agent_config.get('file_id', args.agent)
        agent_file_path = agent_config.get('_file_path', f'agents/{agent_file_id}.md')
        print(f"⏭️  Agent '{agent_name}' is disabled - skipping scheduled job '{args.job}'")
        print(f"   Config: {agent_file_path}")
        return 0

    # Check if schedule is disabled
    if not schedule.get('enabled', True):
        print(f"⏭️  Schedule '{args.job}' is disabled for agent '{agent_name}'")
        return 0

    # Get task content
    repo_root = get_repo_root()

    # Clean up old logs (silently, failures won't affect the scheduled job)
    removed = cleanup_old_logs(repo_root, days=7)
    if removed > 0:
        print(f"   🗑️  Cleaned up {removed} old log file(s)")

    task = get_schedule_task(schedule, repo_root)
    if not task:
        print(f"❌ No task content for schedule '{args.job}'")
        return 1

    print(f"🚀 Running scheduled job: {agent_name}/{args.job}")
    print(f"   Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")

    # Parse timeout
    timeout_seconds = None
    timeout_str = args.timeout or schedule.get('max_runtime', '')
    if timeout_str:
        timeout_seconds = parse_duration(timeout_str)
        if timeout_seconds:
            print(f"   Max runtime: {timeout_str}")

    # Start agent if not running
    was_started = False
    if not session_exists(agent_id):
        print(f"   Starting agent...")

        start_args = argparse.Namespace(
            agent=args.agent,
            working_dir=None
        )

        if cmd_start(start_args) != 0:
            print(f"❌ Failed to start agent")
            return 1

        was_started = True
        time.sleep(2)

    # Check if agent is busy (processing previous task). For long-running stuck/blocked
    # states, self-heal by restarting the session so schedules don't deadlock.
    launcher = resolve_launcher_command(agent_config.get('launcher', ''))
    runtime = get_agent_runtime_state(agent_id, launcher=launcher)
    state = str(runtime.get('state', 'unknown'))
    elapsed = runtime.get('elapsed_seconds')
    did_restart = False

    def _restart_agent(reason: str) -> bool:
        nonlocal did_restart
        print(f"♻️  Restarting agent (reason: {reason})")
        stop_session(agent_id)
        time.sleep(1)
        restart_args = argparse.Namespace(agent=args.agent, working_dir=None)
        if cmd_start(restart_args) != 0:
            print("❌ Failed to restart agent")
            return False
        time.sleep(2)
        did_restart = True
        return True

    if state in ('blocked', 'stuck', 'error'):
        if not _restart_agent(state):
            return 1
    elif state == 'busy':
        should_restart = False
        if timeout_seconds and isinstance(elapsed, int) and elapsed >= timeout_seconds:
            should_restart = True

        if should_restart:
            if not _restart_agent(f"busy>{timeout_seconds}s"):
                return 1
        else:
            # Fall back to legacy busy detection for compatibility.
            if is_agent_busy(agent_id, launcher):
                print(f"⏭️  Agent is busy, skipping scheduled task")
                print(f"   Will retry on next cron execution")
                return 0

    # Optional: clear context by restarting the session before sending the scheduled task.
    # This is intentionally "idle-only" to avoid interrupting interactive use.
    clear_context = bool(schedule.get('clear_context', False))
    if clear_context and not was_started and not did_restart:
        runtime_after = get_agent_runtime_state(agent_id, launcher=launcher)
        state_after = str(runtime_after.get('state', 'unknown'))
        if state_after == 'idle':
            if not _restart_agent('clear_context'):
                return 1

    # Send task
    task_message = f"# Scheduled Task: {args.job}\n\n{task}"
    if not send_keys(agent_id, task_message, send_enter=True):
        print(f"❌ Failed to send task to agent")
        return 1

    print(f"✅ Task sent to {agent_name}")

    # If timeout specified, wait and then stop
    if timeout_seconds and was_started:
        print(f"   Will auto-stop after {timeout_str}")
        # Note: In a real implementation, you might want to monitor
        # the agent's completion status rather than just waiting.
        # For now, we just log and let cron handle the next invocation.

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Agent Manager - Manage employee agents via tmux",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s list                          List all agents
  %(prog)s start dev                     Start dev agent (session: agent-emp-0001)
  %(prog)s start dev --working-dir /path  Start with custom working dir
  %(prog)s stop dev                      Stop dev agent
  %(prog)s monitor dev --follow          Monitor dev output (live)
  %(prog)s send dev "hello"              Send message to dev
  %(prog)s assign dev <<EOF              Assign task to dev
  Fix the bug
  EOF
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # list command
    list_parser = subparsers.add_parser('list', help='List all agents')
    list_parser.add_argument('--running', '-r', action='store_true',
                            help='Show only running agents')

    # start command
    start_parser = subparsers.add_parser('start', help='Start an agent')
    start_parser.add_argument('agent', help='Agent name (e.g., dev, qa) or file ID (e.g., EMP_0001)')
    start_parser.add_argument('--working-dir', '-w', help='Override working directory')

    # stop command
    stop_parser = subparsers.add_parser('stop', help='Stop a running agent')
    stop_parser.add_argument('agent', help='Agent name')

    # monitor command
    monitor_parser = subparsers.add_parser('monitor', help='Monitor agent output')
    monitor_parser.add_argument('agent', help='Agent name')
    monitor_parser.add_argument('--follow', '-f', action='store_true',
                               help='Follow output (like tail -f)')
    monitor_parser.add_argument('--lines', '-n', type=int, default=100,
                               help='Number of lines to show (default: 100)')

    # send command
    send_parser = subparsers.add_parser('send', help='Send message to agent')
    send_parser.add_argument('agent', help='Agent name')
    send_parser.add_argument(
        '--send-enter',
        dest='send_enter',
        action='store_true',
        default=True,
        help='Send Enter after message (default)'
    )
    send_parser.add_argument(
        '--no-enter',
        dest='send_enter',
        action='store_false',
        default=True,
        help='Do not send Enter after message (message will be typed but not submitted)'
    )
    send_parser.add_argument('message', help='Message to send')

    # assign command
    assign_parser = subparsers.add_parser('assign', help='Assign task to agent')
    assign_parser.add_argument('agent', help='Agent name')
    assign_parser.add_argument('--task-file', '-f', help='Read task from file')

    # schedule command with subcommands
    schedule_parser = subparsers.add_parser('schedule', help='Manage scheduled jobs')
    schedule_subparsers = schedule_parser.add_subparsers(dest='schedule_command', help='Schedule commands')

    # schedule list
    schedule_list_parser = schedule_subparsers.add_parser('list', help='List all scheduled jobs')

    # schedule sync
    schedule_sync_parser = schedule_subparsers.add_parser('sync', help='Sync schedules to crontab')
    schedule_sync_parser.add_argument('--dry-run', '-n', action='store_true',
                                      help='Show what would be synced without making changes')

    # schedule run
    schedule_run_parser = schedule_subparsers.add_parser('run', help='Run a scheduled job manually')
    schedule_run_parser.add_argument('agent', help='Agent name')
    schedule_run_parser.add_argument('--job', '-j', required=True, help='Job name to run')
    schedule_run_parser.add_argument('--timeout', '-t', help='Override max runtime (e.g., 30m, 2h)')

    args = parser.parse_args()

    # Show help if no command
    if not args.command:
        parser.print_help()
        return 0

    # Route to appropriate handler
    handlers = {
        'list': cmd_list,
        'start': cmd_start,
        'stop': cmd_stop,
        'monitor': cmd_monitor,
        'send': cmd_send,
        'assign': cmd_assign,
        'schedule': cmd_schedule,
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
        # Allow piping to tools like `head` without dumping a stack trace.
        try:
            sys.stdout.close()
        finally:
            sys.exit(0)
