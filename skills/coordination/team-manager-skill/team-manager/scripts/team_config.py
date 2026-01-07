#!/usr/bin/env python3
"""
Team configuration parser for team-manager skill.

Teams are defined in teams/TEAM_NAME.md files with YAML frontmatter.
Team members are referenced by employee ID (e.g., EMP_0001).
Workflow is defined in the markdown body using mermaid diagrams.
"""

import re
import os
import subprocess
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any


def _find_repo_root(start: Path) -> Path:
    """Find the monorepo root even when this skill is installed via symlink."""
    start_dir = start if start.is_dir() else start.parent

    env_repo_root = os.environ.get('REPO_ROOT')
    if env_repo_root:
        return Path(env_repo_root).expanduser().resolve()

    try:
        sp = subprocess.run(
            ['git', 'rev-parse', '--show-superproject-working-tree'],
            cwd=str(start_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=True,
        ).stdout.strip()
        if sp:
            return Path(sp).resolve()

        top = subprocess.run(
            ['git', 'rev-parse', '--show-toplevel'],
            cwd=str(start_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=True,
        ).stdout.strip()
        if top:
            return Path(top).resolve()
    except Exception:
        pass

    for candidate in [start_dir, *start_dir.parents]:
        if (candidate / 'teams').is_dir() and (candidate / '.agent').is_dir():
            return candidate
    return start_dir


def get_teams_dir() -> Path:
    """Get the teams directory path."""
    # Allow override via environment variable
    teams_dir = os.environ.get('TEAMS_DIR')
    if teams_dir:
        return Path(teams_dir)

    # Default: teams/ in repository root
    repo_root = os.environ.get('REPO_ROOT')
    if repo_root:
        return Path(repo_root) / 'teams'

    # Prefer repo-root derived from this skill's path so commands work from any CWD,
    # including when the skill is installed via symlink into a submodule.
    try:
        repo_root_from_file = _find_repo_root(Path(__file__).resolve())
        candidate = repo_root_from_file / 'teams'
        if candidate.exists():
            return candidate
    except Exception:
        pass

    # Fallback to current working directory
    return Path.cwd() / 'teams'


def parse_team_frontmatter(file_path: Path) -> Optional[Dict[str, Any]]:
    """
    Parse YAML frontmatter from a team configuration file.

    Format:
    ---
    name: frontend
    description: Frontend Development Team
    lead_agent: EMP_0001
    members:
      - employee_id: EMP_0001
        role: lead developer
      - employee_id: EMP_0002
        role: qa tester
    ---

    # TEAM NAME

    ## Workflow
    ```mermaid
    graph TD
      A[Lead receives task] --> B[Assign to Dev]
      B --> C[Dev completes]
      C --> D[Assign to QA]
      D --> E[QA approves]
      E --> F[Lead reports completion]
    ```
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        return None
    except Exception as e:
        print(f"Error reading file {file_path}: {e}")
        return None

    # Extract YAML frontmatter between --- markers
    pattern = r'^---\n(.*?)\n---'
    match = re.match(pattern, content, re.DOTALL)

    if not match:
        return None

    yaml_content = match.group(1)

    try:
        config = yaml.safe_load(yaml_content) or {}
    except yaml.YAMLError as e:
        print(f"Error parsing YAML in {file_path}: {e}")
        return None

    # Extract markdown body (after frontmatter)
    body_pattern = r'^---\n.*?\n---\n(.*)$'
    body_match = re.match(body_pattern, content, re.DOTALL)
    if body_match:
        config['body'] = body_match.group(1).strip()
    else:
        config['body'] = ''

    # Add metadata
    config['_file'] = file_path
    config['_file_name'] = file_path.stem

    return config


def list_all_teams() -> Dict[str, Dict[str, Any]]:
    """List all configured teams from teams/ directory."""
    teams_dir = get_teams_dir()

    if not teams_dir.exists():
        return {}

    teams = {}
    for team_file in sorted(teams_dir.glob('*.md')):
        config = parse_team_frontmatter(team_file)
        if config and 'name' in config:
            teams[config['name']] = config

    return teams


def resolve_team(team_identifier: str) -> Optional[Dict[str, Any]]:
    """
    Resolve a team by name or file name.

    Args:
        team_identifier: Team name (e.g., 'frontend') or file name (e.g., 'frontend')

    Returns:
        Team configuration dict or None if not found.
    """
    all_teams = list_all_teams()

    # Try exact name match
    if team_identifier in all_teams:
        return all_teams[team_identifier]

    # Try file name match
    for team_name, config in all_teams.items():
        if config['_file_name'].lower() == team_identifier.lower():
            return config

    return None


def get_team_members(team_config: Dict[str, Any]) -> List[Dict[str, str]]:
    """
    Get list of team members with their roles.

    Returns:
        List of dicts with 'employee_id' and 'role' keys.
    """
    members = team_config.get('members', [])

    # Support both old format (agent) and new format (employee_id)
    result = []
    for member in members:
        if isinstance(member, dict):
            if 'employee_id' in member:
                result.append(member)
            elif 'agent' in member:
                # Convert old format
                result.append({
                    'employee_id': member['agent'],
                    'role': member.get('role', 'member')
                })
        elif isinstance(member, str):
            # Simple string format - treat as employee_id
            result.append({'employee_id': member, 'role': 'member'})

    return result


def get_lead_agent_id(team_config: Dict[str, Any]) -> Optional[str]:
    """
    Get the lead agent's employee ID.

    Returns:
        Employee ID (e.g., 'EMP_0001') or None if not set.
    """
    return team_config.get('lead_agent')


def get_team_body(team_config: Dict[str, Any]) -> str:
    """
    Get the markdown body of the team configuration.

    Returns:
        Markdown content (including workflow diagrams).
    """
    return team_config.get('body', '')


def get_team_working_directory(team_config: Dict[str, Any]) -> Optional[str]:
    """
    Get the team's working directory.

    This directory overrides individual agent working directories
    when team members are started for team tasks.

    Returns:
        Working directory path or None if not set.
    """
    wd = team_config.get('working_directory')
    if not wd:
        return None

    # Expand environment variables like ${REPO_ROOT}
    if isinstance(wd, str):
        wd = os.path.expandvars(wd)

    return wd


def validate_team_config(config: Dict[str, Any]) -> List[str]:
    """
    Validate team configuration.

    Returns:
        List of error messages (empty if valid).
    """
    errors = []

    required_fields = ['name', 'description', 'lead_agent']
    for field in required_fields:
        if field not in config:
            errors.append(f"Missing required field: {field}")

    members = get_team_members(config)
    if not members:
        errors.append("Team must have at least one member")

    lead_agent = get_lead_agent_id(config)
    if lead_agent:
        member_ids = [m.get('employee_id') for m in members]
        if lead_agent not in member_ids:
            errors.append(f"Lead agent '{lead_agent}' not in members list")

    return errors
