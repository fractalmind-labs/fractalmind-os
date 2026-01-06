"""
Path helper for agent-manager skill.

Automatically detects skill location and resolves repository paths,
allowing the skill to be installed anywhere.
"""

import os
from pathlib import Path
from typing import Optional, Tuple


def find_skill_root() -> Path:
    """
    Find the skill root directory by locating SKILL.md.

    The skill root is the directory containing SKILL.md.

    Returns:
        Path to the skill root directory
    """
    # Start from the location of this file
    current = Path(__file__).resolve()

    # Search upward for SKILL.md
    for parent in [current] + list(current.parents):
        skill_md = parent / 'SKILL.md'
        if skill_md.exists():
            return parent

    # Fallback: use the directory containing this file
    return current.parent


def find_repo_root(skill_root: Optional[Path] = None) -> Path:
    """
    Find the repository root directory.

    The repo root is identified by:
    1. The REPO_ROOT environment variable (if set)
    2. The parent directory containing agents/ directory
    3. The current working directory (fallback)

    Args:
        skill_root: Path to skill root (auto-detected if None)

    Returns:
        Path to the repository root
    """
    # Check environment variable first
    repo_root_env = os.environ.get('REPO_ROOT')
    if repo_root_env:
        return Path(repo_root_env)

    if skill_root is None:
        skill_root = find_skill_root()

    # Search upward for agents/ directory
    for parent in [skill_root] + list(skill_root.parents):
        agents_dir = parent / 'agents'
        if agents_dir.exists() and agents_dir.is_dir():
            return parent

    # Fallback: use current working directory
    return Path.cwd()


def find_skills_dir(repo_root: Optional[Path] = None) -> Path:
    """
    Find the skills directory.

    Searches for:
    1. .agent/skills/
    2. .claude/skills/

    Args:
        repo_root: Path to repository root (auto-detected if None)

    Returns:
        Path to the skills directory (or None if not found)
    """
    if repo_root is None:
        repo_root = find_repo_root()

    # Try .agent/skills first (universal skills)
    agent_skills = repo_root / '.agent' / 'skills'
    if agent_skills.exists() and agent_skills.is_dir():
        return agent_skills

    # Try .claude/skills (project skills)
    claude_skills = repo_root / '.claude' / 'skills'
    if claude_skills.exists() and claude_skills.is_dir():
        return claude_skills

    # Fallback: return .agent/skills (will be created if needed)
    return agent_skills


def get_skill_base_dir() -> str:
    """
    Get the base directory for resolving skill resources.

    This is the string representation of the skill root,
    suitable for returning to AI agents.

    Returns:
        String path to the skill root directory
    """
    return str(find_skill_root())


def resolve_all_paths() -> Tuple[Path, Path, Path]:
    """
    Resolve all key paths at once.

    Returns:
        Tuple of (skill_root, repo_root, skills_dir)
    """
    skill_root = find_skill_root()
    repo_root = find_repo_root(skill_root)
    skills_dir = find_skills_dir(repo_root)

    return skill_root, repo_root, skills_dir


# Export convenience functions
__all__ = [
    'find_skill_root',
    'find_repo_root',
    'find_skills_dir',
    'get_skill_base_dir',
    'resolve_all_paths',
]
