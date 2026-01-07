#!/usr/bin/env python3
"""
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()


import re
import os
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any


def get_teams_dir() -> Path:
    """
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

    # Allow override via environment variable
    teams_dir = os.environ.get('TEAMS_DIR')
    if teams_dir:
        return Path(teams_dir)

    # Default: teams/ in repository root
    repo_root = os.environ.get('REPO_ROOT')
    if repo_root:
        return Path(repo_root) / 'teams'

    # Fallback to current directory
    return Path.cwd() / 'teams'


def parse_team_frontmatter(file_path: Path) -> Optional[Dict[str, Any]]:
    """
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

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
    """
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

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
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

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
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

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
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

    return team_config.get('lead_agent')


def get_team_body(team_config: Dict[str, Any]) -> str:
    """
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

    return team_config.get('body', '')


def get_team_working_directory(team_config: Dict[str, Any]) -> Optional[str]:
    """
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

    wd = team_config.get('working_directory')
    if not wd:
        return None

    # Expand environment variables like ${REPO_ROOT}
    if isinstance(wd, str):
        wd = os.path.expandvars(wd)

    return wd


def validate_team_config(config: Dict[str, Any]) -> List[str]:
    """
Team configuration parser for team-manager skill.
"""

import re
import yaml
from pathlib import Path
from typing import Optional, Dict, Any, List

# Import path helper
try:
    from path_helper import find_teams_dir, find_repo_root
except ImportError:
    # Fallback for development
    def find_teams_dir(): return Path.cwd() / 'teams'
    def find_repo_root(): return Path.cwd()

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
