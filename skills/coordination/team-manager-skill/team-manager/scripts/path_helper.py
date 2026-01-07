"""
Path helper for team-manager skill.

Automatically detects skill location and resolves repository paths.
"""

import os
from pathlib import Path
from typing import Optional


def find_skill_root() -> Path:
    """
    Find the skill root directory by locating SKILL.md.

    Returns:
        Path to the skill root directory
    """
    current = Path(__file__).resolve()

    # Search upward for SKILL.md
    for parent in [current] + list(current.parents):
        skill_md = parent / 'SKILL.md'
        if skill_md.exists():
            return parent

    # Fallback
    return current.parent


def find_repo_root(skill_root: Optional[Path] = None) -> Path:
    """
    Find the repository root directory.

    Args:
        skill_root: Path to skill root (auto-detected if None)

    Returns:
        Path to the repository root
    """
    repo_root_env = os.environ.get('REPO_ROOT')
    if repo_root_env:
        return Path(repo_root_env)

    if skill_root is None:
        skill_root = find_skill_root()

    # Search upward for teams/ or agents/ directory
    for parent in [skill_root] + list(skill_root.parents):
        teams_dir = parent / 'teams'
        agents_dir = parent / 'agents'
        if (teams_dir.exists() and teams_dir.is_dir()) or \
           (agents_dir.exists() and agents_dir.is_dir()):
            return parent

    # Fallback
    return Path.cwd()


def find_teams_dir(repo_root: Optional[Path] = None) -> Path:
    """
    Find the teams directory.

    Args:
        repo_root: Path to repository root (auto-detected if None)

    Returns:
        Path to the teams directory
    """
    if repo_root is None:
        repo_root = find_repo_root()

    return repo_root / 'teams'


def find_agent_manager_dir(repo_root: Optional[Path] = None) -> Optional[Path]:
    """
    Find the agent-manager skill directory.

    Searches in:
    1. .claude/skills/agent-manager
    2. .agent/skills/agent-manager

    Args:
        repo_root: Path to repository root (auto-detected if None)

    Returns:
        Path to agent-manager or None if not found
    """
    if repo_root is None:
        repo_root = find_repo_root()

    # Try .claude/skills first
    agent_manager = repo_root / '.claude' / 'skills' / 'agent-manager'
    if agent_manager.exists() and agent_manager.is_dir():
        return agent_manager

    # Try .agent/skills
    agent_manager = repo_root / '.agent' / 'skills' / 'agent-manager'
    if agent_manager.exists() and agent_manager.is_dir():
        return agent_manager

    return None


def get_skill_base_dir() -> str:
    """Get the base directory for resolving skill resources."""
    return str(find_skill_root())


__all__ = [
    'find_skill_root',
    'find_repo_root',
    'find_teams_dir',
    'find_agent_manager_dir',
    'get_skill_base_dir',
]
