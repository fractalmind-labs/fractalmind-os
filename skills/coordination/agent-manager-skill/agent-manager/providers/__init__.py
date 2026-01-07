"""Provider configurations for different CLI tools."""

import os
from pathlib import Path
from typing import List, Dict, Optional


# Provider definitions
PROVIDERS: Dict[str, Dict] = {
    'claude-code': {
        'name': 'Claude Code',
        'prompt_patterns': ['>', '>\xa0', '⟩'],
        'startup_wait': 0,
        'description': 'Official Claude Code CLI',
        'launch_command': None,  # Uses ccc script
        'system_prompt': {
            'mode': 'cli_append',
            'flag': '--append-system-prompt',
        },
        # Best-effort runtime heuristics (used by agent-manager/tmux_helper).
        'runtime': {
            'busy_patterns': [
                '✻ Forging',
                '✻ Spelunking',
                '✻ Thinking',
                'Forging…',
                'Spelunking…',
                'Working…',
                '⏳ Thinking',
                '(esc to interrupt',
            ],
            'blocked_patterns': [
                'actions require approval',
                'requires approval',
                'waiting for approval',
            ],
            'stuck_after_seconds': 180,
        },
    },
    'droid': {
        'name': 'Droid',
        'prompt_patterns': ['>', '>\xa0', '⟩'],
        'startup_wait': 5,
        'prompt_check': 'droid',  # Look for droid-specific patterns
        'description': 'Droid CLI agent',
        'launch_command': 'droid',  # Direct droid command
        'system_prompt': {
            'mode': 'tmux_paste',
        },
        'runtime': {
            'busy_patterns': [
                'Thinking...',
                'Thinking…',
                '⏳ Thinking',
                '⠋ Thinking',
                '⠙ Thinking',
                '⠹ Thinking',
                '⠸ Thinking',
                '⠼ Thinking',
                '⠴ Thinking',
                '⠦ Thinking',
                '⠧ Thinking',
                '⠇ Thinking',
                '(esc to interrupt',
            ],
            'blocked_patterns': [
                'all actions require approval',
                'actions require approval',
                'requires approval',
                'waiting for approval',
            ],
            'stuck_after_seconds': 180,
        },
    },
    'claude': {
        'name': 'Claude',
        'prompt_patterns': ['>', '⟩', ':'],
        'startup_wait': 1,
        'description': 'Generic Claude CLI',
        'system_prompt': {
            'mode': 'cli_append',
            'flag': '--append-system-prompt',
        },
        'runtime': {
            'busy_patterns': [
                '✻ Thinking',
                'Thinking...',
                '⏳ Thinking',
                '(esc to interrupt',
            ],
            'blocked_patterns': [
                'actions require approval',
                'requires approval',
            ],
            'stuck_after_seconds': 180,
        },
    },
    'generic': {
        'name': 'Generic',
        'prompt_patterns': ['>', '$', '#', ':', '⟩'],
        'startup_wait': 1,
        'description': 'Generic CLI with common prompts',
        'system_prompt': {
            'mode': 'tmux_paste',
        },
        'runtime': {
            'busy_patterns': [
                'Thinking...',
                'Thinking…',
                'Working…',
                '⏳ Thinking',
                '(esc to interrupt',
            ],
            'blocked_patterns': [
                'actions require approval',
                'requires approval',
                'waiting for approval',
            ],
            'stuck_after_seconds': 180,
        },
    },
    'opencode': {
        'name': 'OpenCode',
        # OpenCode uses a full-screen TUI; tmux capture-pane often doesn't expose a stable prompt.
        # We treat readiness as "process started" and rely on startup_wait.
        'prompt_patterns': [],
        'startup_wait': 2,
        'description': 'OpenCode CLI agent (opencode.ai)',
        'launch_command': 'opencode',
        'system_prompt': {
            # OpenCode supports passing a prompt via CLI.
            'mode': 'cli_append',
            'flag': '--prompt',
        },
        'runtime': {
            'busy_patterns': [
                'Thinking...',
                'Thinking…',
                '⏳ Thinking',
                '(esc to interrupt',
            ],
            'blocked_patterns': [
                'actions require approval',
                'requires approval',
                'waiting for approval',
            ],
            'stuck_after_seconds': 180,
        },
    },
}


def resolve_launcher_command(launcher: str) -> str:
    """Resolve a launcher name to an executable path when possible.

    This keeps agent configs simple (e.g. `launcher: opencode`) while still working
    when PATH isn't set up in non-interactive shells.
    """
    launcher = (launcher or "").strip()
    if not launcher:
        return launcher

    # If launcher already looks like a path, don't rewrite it.
    if "/" in launcher or launcher.startswith("."):
        return launcher

    if launcher.lower() == "opencode":
        candidate = Path(os.path.expanduser("~")) / ".opencode" / "bin" / "opencode"
        if candidate.exists():
            return str(candidate)

    return launcher


def get_provider(launcher: str) -> Dict:
    """
    Get provider configuration based on launcher path/name.

    Args:
        launcher: Launcher path or name (e.g., 'droid', '/path/to/ccc')

    Returns:
        Provider configuration dict
    """
    launcher_lower = launcher.lower()

    # Check for provider name in launcher
    if 'droid' in launcher_lower:
        return PROVIDERS['droid']
    elif 'opencode' in launcher_lower:
        return PROVIDERS['opencode']
    elif 'claude-code' in launcher_lower or 'ccc' in launcher_lower:
        return PROVIDERS['claude-code']
    elif 'claude' in launcher_lower:
        return PROVIDERS['claude']
    else:
        return PROVIDERS['generic']


def get_prompt_patterns(launcher: str) -> List[str]:
    """Get prompt patterns for a given launcher."""
    provider = get_provider(launcher)
    return provider.get('prompt_patterns', ['>', '$'])


def get_startup_wait(launcher: str) -> int:
    """Get startup wait time for a given launcher."""
    provider = get_provider(launcher)
    return provider.get('startup_wait', 1)


def get_system_prompt_config(launcher: str) -> Dict:
    """Get system prompt injection configuration for a given launcher."""
    provider = get_provider(launcher)
    return provider.get('system_prompt', {'mode': 'tmux_paste'})


def get_runtime_config(launcher: str) -> Dict:
    """Get provider runtime heuristics configuration."""
    provider = get_provider(launcher)
    return provider.get('runtime', {})


def get_busy_patterns(launcher: str) -> List[str]:
    """Get busy patterns for a given launcher/provider."""
    cfg = get_runtime_config(launcher)
    return cfg.get('busy_patterns', [])


def get_blocked_patterns(launcher: str) -> List[str]:
    """Get blocked/approval patterns for a given launcher/provider."""
    cfg = get_runtime_config(launcher)
    return cfg.get('blocked_patterns', [])


def get_stuck_after_seconds(launcher: str) -> int:
    """Get "stuck" threshold (seconds) for a given launcher/provider."""
    cfg = get_runtime_config(launcher)
    return int(cfg.get('stuck_after_seconds', 180))


def get_system_prompt_mode(launcher: str) -> str:
    """Get system prompt injection mode.

    Modes:
    - cli_append: pass system prompt via CLI flag (true system prompt)
    - tmux_paste: paste prompt into the session after startup (fallback)
    """
    return get_system_prompt_config(launcher).get('mode', 'tmux_paste')


def get_system_prompt_flag(launcher: str) -> Optional[str]:
    """Get the CLI flag to use for system prompt injection, if supported."""
    return get_system_prompt_config(launcher).get('flag')


def list_providers() -> Dict[str, Dict]:
    """List all available providers."""
    return PROVIDERS
