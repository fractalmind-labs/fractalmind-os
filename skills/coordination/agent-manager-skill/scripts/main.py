#!/usr/bin/env python3
"""
Agent Manager - CLI for managing employee agents in tmux sessions.

A simple alternative to CAO using only tmux + Python.
Sessions are named: agent-{agent_id}
"""

import argparse
import sys
from pathlib import Path

# Add scripts directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

# Import provider system
skill_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(skill_root))

try:
    from path_helper import find_repo_root, find_skills_dir
except ImportError:
    # Fallback for development
    def find_repo_root(): return Path.cwd()
    def find_skills_dir(): return Path.cwd() / '.agent' / 'skills'


def get_agent_id(config: dict) -> str:
    """Get agent_id from config (file_id in lowercase, with hyphens)."""
    file_id = config.get('file_id', 'UNKNOWN')
    return file_id.lower().replace('_', '-')


def cmd_list(args):
    """List all agents (configured and running)."""
    import subprocess
    
    print("📋 Agents:")
    print()
    
    # Check tmux
    try:
        result = subprocess.run(['tmux', 'ls'], capture_output=True, text=True)
        sessions = result.stdout.split('\n') if result.returncode == 0 else []
    except FileNotFoundError:
        print("  ⚠️  tmux not found. Install with: apt install tmux or brew install tmux")
        return 1
    
    running = [s.split(':')[0] for s in sessions if s.strip()]
    
    if running:
        for session in running:
            print(f"  ✅ Running: {session}")
    else:
        print("  No agents running")
    
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Agent Manager - Manage employee agents via tmux",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s list                          List all agents
  %(prog)s start dev                     Start dev agent
  %(prog)s stop dev                      Stop dev agent
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # list command
    list_parser = subparsers.add_parser('list', help='List all agents')
    
    # start command
    start_parser = subparsers.add_parser('start', help='Start an agent')
    start_parser.add_argument('agent', help='Agent name')
    
    # stop command
    stop_parser = subparsers.add_parser('stop', help='Stop a running agent')
    stop_parser.add_argument('agent', help='Agent name')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return 0
    
    handlers = {
        'list': cmd_list,
        'start': lambda args: print("🚧 Start command requires full implementation"),
        'stop': lambda args: print("🚧 Stop command requires full implementation"),
    }
    
    handler = handlers.get(args.command)
    if handler:
        return handler(args)
    
    parser.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
