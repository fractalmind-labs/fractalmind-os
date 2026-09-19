#!/usr/bin/env python3
"""
Agent status detection module.

Detects agent states: working, idle, quota-exhausted, error, stopped.
"""

import re
import subprocess
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple
from enum import Enum


class AgentState(Enum):
    """Agent state enumeration."""
    WORKING = "working"
    IDLE = "idle"
    QUOTA_EXHAUSTED = "quota-exhausted"
    ERROR = "error"
    STOPPED = "stopped"


def capture_tmux_output(session_name: str, lines: int = 100) -> Optional[str]:
    """
    Capture output from tmux session.

    Args:
        session_name: Tmux session name (e.g., 'agent-emp-0007')
        lines: Number of lines to capture from the end

    Returns:
        Captured output or None if session doesn't exist
    """
    try:
        result = subprocess.run(
            ['tmux', 'capture-pane', '-p', '-t', session_name, '-S', f'-{lines}'],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            return result.stdout
        return None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def detect_quota_exhausted(output: str) -> Optional[Tuple[datetime, str]]:
    """
    Detect if agent has hit API quota limit.

    Args:
        output: Tmux output text

    Returns:
        Tuple of (reset_time, error_message) or None
    """
    # Common patterns for quota errors
    patterns = [
        r'Usage limit reached.*?reset at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})',
        r'limit will reset at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})',
        r'"message":"Usage limit.*?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})',
    ]

    for pattern in patterns:
        match = re.search(pattern, output, re.IGNORECASE)
        if match:
            reset_str = match.group(1)

            # Parse reset time
            try:
                # Try ISO format first
                if 'T' in reset_str:
                    reset_time = datetime.fromisoformat(reset_str.replace('Z', '+00:00'))
                else:
                    # Try standard format
                    reset_time = datetime.strptime(reset_str, '%Y-%m-%d %H:%M:%S')
                    reset_time = reset_time.replace(tzinfo=timezone.utc)

                # Extract error context
                error_match = re.search(r'(API Error.*?429.*?})', output, re.DOTALL)
                error_msg = error_match.group(1) if error_match else "API Error 429"

                return (reset_time, error_msg)
            except (ValueError, AttributeError):
                continue

    # Fallback: check for 429 without reset time
    if '429' in output and 'limit' in output.lower():
        return (None, "API Error 429 - Usage limit (unknown reset time)")

    return None


def detect_idle_time(output: str) -> Optional[int]:
    """
    Detect agent idle time from prompt timer.

    Args:
        output: Tmux output text

    Returns:
        Idle time in seconds or None
    """
    # Pattern: [⏱ 1h 9m] or [⏱ 3m 37s]
    pattern = r'\[⏱\s+(?:(\d+)h\s+)?(\d+)m\s+(?:(\d+)s)?\]'

    match = re.search(pattern, output)
    if match:
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2))
        seconds = int(match.group(3) or 0)

        return hours * 3600 + minutes * 60 + seconds

    return None


def detect_agent_state(agent_id: str, agent_config: Dict) -> Dict:
    """
    Detect comprehensive state of an agent.

    Args:
        agent_id: Employee ID (e.g., 'EMP_0007')
        agent_config: Agent configuration from agents/EMP_*.md

    Returns:
        Dict with state information:
        {
            'agent_id': 'EMP_0007',
            'name': 'director',
            'state': AgentState.QUOTA_EXHAUSTED,
            'reset_time': datetime(...),  # if quota exhausted
            'wait_seconds': 18000,  # if quota exhausted
            'idle_seconds': 4200,  # if idle
            'last_activity': '...',
            'error': 'API Error 429',  # if error
        }
    """
    session_name = f"agent-{agent_id.lower().replace('_', '-')}"

    # Check if session exists
    output = capture_tmux_output(session_name)
    if output is None:
        return {
            'agent_id': agent_id,
            'name': agent_config.get('name', 'unknown'),
            'state': AgentState.STOPPED,
            'session_name': session_name
        }

    # Check for quota exhaustion
    quota_info = detect_quota_exhausted(output)
    if quota_info:
        reset_time, error_msg = quota_info

        result = {
            'agent_id': agent_id,
            'name': agent_config.get('name', 'unknown'),
            'state': AgentState.QUOTA_EXHAUSTED,
            'session_name': session_name,
            'error': error_msg,
            'reset_time': reset_time
        }

        if reset_time:
            now = datetime.now(timezone.utc)
            wait_seconds = int((reset_time - now).total_seconds())
            result['wait_seconds'] = max(0, wait_seconds)

        return result

    # Check for idle state
    idle_seconds = detect_idle_time(output)
    if idle_seconds is not None:
        return {
            'agent_id': agent_id,
            'name': agent_config.get('name', 'unknown'),
            'state': AgentState.IDLE,
            'session_name': session_name,
            'idle_seconds': idle_seconds
        }

    # Check if actively working
    # Look for build indicators, thinking messages, etc.
    working_indicators = ['Build', 'Thinking', 'Analyzing', 'Processing']
    if any(indicator in output for indicator in working_indicators):
        return {
            'agent_id': agent_id,
            'name': agent_config.get('name', 'unknown'),
            'state': AgentState.WORKING,
            'session_name': session_name
        }

    # Check for errors
    error_indicators = ['Error:', 'ERROR', 'Exception', 'Traceback']
    last_lines = '\n'.join(output.split('\n')[-20:])
    if any(indicator in last_lines for indicator in error_indicators):
        # Extract error message
        error_match = re.search(r'(Error:.*|Exception:.*|Traceback:.*)', last_lines)
        error_msg = error_match.group(1).strip() if error_match else "Unknown error"

        return {
            'agent_id': agent_id,
            'name': agent_config.get('name', 'unknown'),
            'state': AgentState.ERROR,
            'session_name': session_name,
            'error': error_msg
        }

    # Default: running but no specific state detected
    return {
        'agent_id': agent_id,
        'name': agent_config.get('name', 'unknown'),
        'state': AgentState.WORKING,
        'session_name': session_name
    }


def format_wait_time(seconds: int) -> str:
    """Format wait time in human-readable format."""
    if seconds < 60:
        return f"{seconds}s"
    elif seconds < 3600:
        minutes = seconds // 60
        return f"{minutes}m"
    else:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        if minutes > 0:
            return f"{hours}h {minutes}m"
        else:
            return f"{hours}h"


def format_idle_time(seconds: int) -> str:
    """Format idle time in human-readable format."""
    if seconds < 60:
        return f"{seconds}s"
    elif seconds < 3600:
        minutes = seconds // 60
        secs = seconds % 60
        if secs > 0:
            return f"{minutes}m {secs}s"
        else:
            return f"{minutes}m"
    else:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        if minutes > 0:
            return f"{hours}h {minutes}m"
        else:
            return f"{hours}h"
