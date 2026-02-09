#!/usr/bin/env python3
"""
Agent Manager - CLI for managing employee agents in tmux sessions.

A simple alternative to CAO using only tmux + Python.
Sessions are named: agent-{agent_id} where agent_id is file_id in lowercase (e.g., emp-0001)
"""

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Add scripts directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from agent_config import (
    resolve_agent,
    list_all_agents,
    load_skills,
    build_system_prompt,
    expand_env_vars,
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
    start_session_with_layout,
    stop_session,
    capture_output,
    send_keys,
    get_session_info,
    wait_for_prompt,
    inject_system_prompt,
    wait_for_agent_ready,
    get_agent_runtime_state,
)

# Import provider system (lives at .agent/skills/agent-manager/providers)
sys.path.insert(0, str(Path(__file__).parent.parent))
from providers import (
    get_system_prompt_mode,
    get_system_prompt_flag,
    get_system_prompt_key,
    get_agents_md_mode,
    get_mcp_config_mode,
    get_mcp_config_flag,
    resolve_launcher_command,
    get_provider_key,
    get_session_restore_mode,
    get_session_restore_flag,
    get_context_left_patterns,
)

from cli_parser import create_parser
from command_registry import get_command_handlers
from commands.lifecycle import (
    cmd_start as lifecycle_cmd_start,
    cmd_stop as lifecycle_cmd_stop,
    cmd_monitor as lifecycle_cmd_monitor,
    cmd_send as lifecycle_cmd_send,
    cmd_assign as lifecycle_cmd_assign,
)


def _normalize_path(path: str) -> str:
    try:
        return str(Path(path).resolve())
    except Exception:
        return os.path.abspath(path)


def _provider_sessions_state_dir(repo_root: Path) -> Path:
    return repo_root / '.claude' / 'state' / 'agent-manager' / 'provider-sessions'


def _load_provider_session_id(repo_root: Path, provider: str, agent_id: str) -> str:
    path = _provider_sessions_state_dir(repo_root) / provider / f"{agent_id}.json"
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
        session_id = str(payload.get('session_id') or '').strip()
        return session_id
    except Exception:
        return ""


def _save_provider_session_id(repo_root: Path, provider: str, agent_id: str, *, session_id: str, cwd: str) -> None:
    provider_dir = _provider_sessions_state_dir(repo_root) / provider
    provider_dir.mkdir(parents=True, exist_ok=True)
    path = provider_dir / f"{agent_id}.json"
    payload = {
        'provider': provider,
        'agent_id': agent_id,
        'session_id': session_id,
        'cwd': cwd,
        'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding='utf-8')


def _droid_sessions_dir_for_cwd(cwd: str) -> Path:
    normalized = _normalize_path(cwd)
    folder_name = "-" + normalized.lstrip('/').replace('/', '-')
    return Path.home() / '.factory' / 'sessions' / folder_name


def _droid_session_jsonl_path(cwd: str, session_id: str) -> Path:
    return _droid_sessions_dir_for_cwd(cwd) / f"{session_id}.jsonl"


def _droid_session_exists(cwd: str, session_id: str) -> bool:
    if not session_id:
        return False
    try:
        return _droid_session_jsonl_path(cwd, session_id).exists()
    except Exception:
        return False


def _snapshot_droid_sessions(cwd: str) -> set[str]:
    sessions_dir = _droid_sessions_dir_for_cwd(cwd)
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return set()
    return {str(p) for p in sessions_dir.glob('*.jsonl')}


def _extract_droid_session_id_from_jsonl(jsonl_path: Path) -> str:
    try:
        with jsonl_path.open('r', encoding='utf-8') as f:
            for _ in range(10):
                line = f.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                if payload.get('type') == 'session_start':
                    return str(payload.get('id') or '').strip()
        return ""
    except Exception:
        return ""


def _find_new_droid_session_id(cwd: str, *, before_jsonl_paths: set[str]) -> str:
    sessions_dir = _droid_sessions_dir_for_cwd(cwd)
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return ""

    candidates = [p for p in sessions_dir.glob('*.jsonl') if str(p) not in before_jsonl_paths]
    if not candidates:
        return ""

    newest = max(candidates, key=lambda p: p.stat().st_mtime)
    return _extract_droid_session_id_from_jsonl(newest)


def _find_new_droid_session_id_with_retry(cwd: str, *, before_jsonl_paths: set[str], timeout_s: float = 2.0) -> str:
    deadline = time.time() + max(0.0, float(timeout_s))
    while True:
        session_id = _find_new_droid_session_id(cwd, before_jsonl_paths=before_jsonl_paths)
        if session_id:
            return session_id
        if time.time() >= deadline:
            return ""
        time.sleep(0.2)


_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _looks_like_uuid(value: str) -> bool:
    return bool(value and _UUID_RE.match(value))


def _claude_projects_dir_for_cwd(cwd: str) -> Path:
    normalized = _normalize_path(cwd)
    folder_name = "-" + normalized.lstrip('/').replace('/', '-')
    return Path.home() / '.claude' / 'projects' / folder_name


def _claude_session_jsonl_path(cwd: str, session_id: str) -> Path:
    return _claude_projects_dir_for_cwd(cwd) / f"{session_id}.jsonl"


def _claude_session_exists(cwd: str, session_id: str) -> bool:
    if not _looks_like_uuid(session_id):
        return False
    try:
        return _claude_session_jsonl_path(cwd, session_id).exists()
    except Exception:
        return False


def _snapshot_claude_sessions(cwd: str) -> set[str]:
    sessions_dir = _claude_projects_dir_for_cwd(cwd)
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return set()
    return {str(p) for p in sessions_dir.glob('*.jsonl')}


def _extract_claude_session_id_from_jsonl(jsonl_path: Path) -> str:
    try:
        with jsonl_path.open('r', encoding='utf-8') as f:
            for _ in range(10):
                line = f.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                session_id = str(payload.get('sessionId') or payload.get('session_id') or '').strip()
                if _looks_like_uuid(session_id):
                    return session_id
        return ""
    except Exception:
        return ""


def _find_new_claude_session_id(cwd: str, *, before_jsonl_paths: set[str]) -> str:
    sessions_dir = _claude_projects_dir_for_cwd(cwd)
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return ""

    candidates = [p for p in sessions_dir.glob('*.jsonl') if str(p) not in before_jsonl_paths]
    if not candidates:
        # Best-effort fallback: pick newest session file we can parse.
        candidates = list(sessions_dir.glob('*.jsonl'))
    if not candidates:
        return ""

    for candidate in sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True):
        session_id = _extract_claude_session_id_from_jsonl(candidate)
        if session_id:
            return session_id

    return ""


def _find_new_claude_session_id_with_retry(cwd: str, *, before_jsonl_paths: set[str], timeout_s: float = 2.0) -> str:
    deadline = time.time() + max(0.0, float(timeout_s))
    while True:
        session_id = _find_new_claude_session_id(cwd, before_jsonl_paths=before_jsonl_paths)
        if session_id:
            return session_id
        if time.time() >= deadline:
            return ""
        time.sleep(0.2)


def _codex_sessions_dir() -> Path:
    return Path.home() / '.codex' / 'sessions'


def _codex_session_exists(cwd: str, session_id: str) -> bool:
    if not _looks_like_uuid(session_id):
        return False
    sessions_dir = _codex_sessions_dir()
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return False
    try:
        for p in sessions_dir.rglob('*.jsonl'):
            if session_id in p.name:
                return True
        return False
    except Exception:
        return False


def _snapshot_codex_sessions(cwd: str) -> set[str]:
    sessions_dir = _codex_sessions_dir()
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return set()
    return {str(p) for p in sessions_dir.rglob('*.jsonl')}


def _extract_codex_session_id_from_jsonl(jsonl_path: Path) -> str:
    try:
        with jsonl_path.open('r', encoding='utf-8') as f:
            for _ in range(10):
                line = f.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                p = payload.get('payload') or {}
                session_id = str(p.get('id') or '').strip()
                if _looks_like_uuid(session_id):
                    return session_id
        return ""
    except Exception:
        return ""


def _find_new_codex_session_id(cwd: str, *, before_jsonl_paths: set[str]) -> str:
    sessions_dir = _codex_sessions_dir()
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return ""

    candidates = [p for p in sessions_dir.rglob('*.jsonl') if str(p) not in before_jsonl_paths]
    if not candidates:
        candidates = list(sessions_dir.rglob('*.jsonl'))
    if not candidates:
        return ""

    for candidate in sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True):
        session_id = _extract_codex_session_id_from_jsonl(candidate)
        if session_id:
            return session_id

    return ""


def _find_new_codex_session_id_with_retry(cwd: str, *, before_jsonl_paths: set[str], timeout_s: float = 2.0) -> str:
    deadline = time.time() + max(0.0, float(timeout_s))
    while True:
        session_id = _find_new_codex_session_id(cwd, before_jsonl_paths=before_jsonl_paths)
        if session_id:
            return session_id
        if time.time() >= deadline:
            return ""
        time.sleep(0.2)


def _opencode_storage_dir() -> Path:
    return Path.home() / '.local' / 'share' / 'opencode' / 'storage'


def _opencode_project_id_for_cwd(cwd: str) -> str:
    normalized = _normalize_path(cwd)
    project_dir = _opencode_storage_dir() / 'project'
    if not project_dir.exists() or not project_dir.is_dir():
        return ""

    for p in project_dir.glob('*.json'):
        try:
            payload = json.loads(p.read_text(encoding='utf-8'))
            worktree = str(payload.get('worktree') or '').strip()
            if worktree and _normalize_path(worktree) == normalized:
                return str(payload.get('id') or p.stem).strip()
        except Exception:
            continue

    return ""


def _opencode_sessions_dir_for_project(project_id: str) -> Path:
    return _opencode_storage_dir() / 'session' / project_id


def _opencode_session_json_path(cwd: str, session_id: str) -> Path:
    project_id = _opencode_project_id_for_cwd(cwd)
    return _opencode_sessions_dir_for_project(project_id) / f"{session_id}.json"


def _opencode_session_exists(cwd: str, session_id: str) -> bool:
    if not session_id or not session_id.startswith('ses_'):
        return False
    project_id = _opencode_project_id_for_cwd(cwd)
    if not project_id:
        return False
    try:
        return (_opencode_sessions_dir_for_project(project_id) / f"{session_id}.json").exists()
    except Exception:
        return False


def _snapshot_opencode_sessions(cwd: str) -> set[str]:
    project_id = _opencode_project_id_for_cwd(cwd)
    if not project_id:
        return set()
    sessions_dir = _opencode_sessions_dir_for_project(project_id)
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return set()
    return {str(p) for p in sessions_dir.glob('*.json')}


def _extract_opencode_session_id_from_json(json_path: Path) -> str:
    try:
        payload = json.loads(json_path.read_text(encoding='utf-8'))
        session_id = str(payload.get('id') or '').strip()
        if session_id.startswith('ses_'):
            return session_id
        return ""
    except Exception:
        return ""


def _find_new_opencode_session_id(cwd: str, *, before_json_paths: set[str]) -> str:
    project_id = _opencode_project_id_for_cwd(cwd)
    if not project_id:
        return ""
    sessions_dir = _opencode_sessions_dir_for_project(project_id)
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return ""

    candidates = [p for p in sessions_dir.glob('*.json') if str(p) not in before_json_paths]
    if not candidates:
        candidates = list(sessions_dir.glob('*.json'))
    if not candidates:
        return ""

    for candidate in sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True):
        session_id = _extract_opencode_session_id_from_json(candidate)
        if session_id:
            return session_id

    return ""


def _find_new_opencode_session_id_with_retry(cwd: str, *, before_json_paths: set[str], timeout_s: float = 2.0) -> str:
    deadline = time.time() + max(0.0, float(timeout_s))
    while True:
        session_id = _find_new_opencode_session_id(cwd, before_json_paths=before_json_paths)
        if session_id:
            return session_id
        if time.time() >= deadline:
            return ""
        time.sleep(0.2)


def _provider_session_exists(provider_key: str, cwd: str, session_id: str) -> bool:
    if provider_key == 'droid':
        return _droid_session_exists(cwd, session_id)
    if provider_key in {'claude', 'claude-code'}:
        return _claude_session_exists(cwd, session_id)
    if provider_key == 'codex':
        return _codex_session_exists(cwd, session_id)
    if provider_key == 'opencode':
        return _opencode_session_exists(cwd, session_id)
    return False


def _snapshot_provider_sessions(provider_key: str, cwd: str) -> set[str]:
    if provider_key == 'droid':
        return _snapshot_droid_sessions(cwd)
    if provider_key in {'claude', 'claude-code'}:
        return _snapshot_claude_sessions(cwd)
    if provider_key == 'codex':
        return _snapshot_codex_sessions(cwd)
    if provider_key == 'opencode':
        return _snapshot_opencode_sessions(cwd)
    return set()


def _find_new_provider_session_id_with_retry(provider_key: str, cwd: str, *, before_paths: set[str], timeout_s: float = 2.0) -> str:
    if provider_key == 'droid':
        return _find_new_droid_session_id_with_retry(cwd, before_jsonl_paths=before_paths, timeout_s=timeout_s)
    if provider_key in {'claude', 'claude-code'}:
        return _find_new_claude_session_id_with_retry(cwd, before_jsonl_paths=before_paths, timeout_s=timeout_s)
    if provider_key == 'codex':
        return _find_new_codex_session_id_with_retry(cwd, before_jsonl_paths=before_paths, timeout_s=timeout_s)
    if provider_key == 'opencode':
        return _find_new_opencode_session_id_with_retry(cwd, before_json_paths=before_paths, timeout_s=timeout_s)
    return ""


def _apply_session_restore_args(
    provider_key: str,
    launcher: str,
    launcher_args: list[str],
    restore_flag: str,
    session_id: str,
) -> list[str]:
    """Insert provider resume args without breaking wrapper launchers.

    For the repo-local `ccc` wrapper, the first arg is a model/account selector and
    must stay first; claude options follow after.
    """
    launcher_lower = (launcher or "").lower()
    if provider_key == 'codex' and restore_flag == 'resume':
        return ['resume', session_id] + list(launcher_args or [])
    if provider_key == 'claude-code' and 'ccc' in launcher_lower:
        if launcher_args and not str(launcher_args[0]).startswith('-'):
            return [launcher_args[0], restore_flag, session_id] + launcher_args[1:]
    return [restore_flag, session_id] + list(launcher_args or [])


def write_system_prompt_file(repo_root: Path, agent_id: str, system_prompt: str) -> Path:
    state_dir = repo_root / '.claude' / 'state' / 'system-prompts'
    state_dir.mkdir(parents=True, exist_ok=True)
    prompt_file = state_dir / f"{agent_id}.txt"
    prompt_file.write_text(system_prompt + "\n", encoding='utf-8')
    return prompt_file


def write_scheduled_task_file(repo_root: Path, agent_id: str, job: str, task: str) -> Path:
    state_dir = repo_root / '.claude' / 'state' / 'agent-manager' / 'scheduled-tasks' / agent_id
    state_dir.mkdir(parents=True, exist_ok=True)
    safe_job = "".join(ch if (ch.isalnum() or ch in ('-', '_')) else '-' for ch in (job or 'job'))
    task_file = state_dir / f"{safe_job}.md"
    task_file.write_text(task + "\n", encoding='utf-8')
    return task_file


def _should_use_codex_file_pointer(message: str) -> bool:
    if not message:
        return False
    line_count = message.count("\n") + 1
    return line_count >= 12 or len(message) >= 1800


def write_codex_message_file(repo_root: Path, agent_id: str, purpose: str, message: str) -> Path:
    state_dir = repo_root / '.claude' / 'state' / 'agent-manager' / 'codex-messages' / agent_id
    state_dir.mkdir(parents=True, exist_ok=True)
    safe_purpose = "".join(ch if (ch.isalnum() or ch in ('-', '_')) else '-' for ch in (purpose or 'message'))
    ts = int(time.time())
    msg_file = state_dir / f"{safe_purpose}-{ts}.md"
    msg_file.write_text(message + "\n", encoding='utf-8')
    return msg_file



_HEARTBEAT_SESSION_MODES = {"restore", "auto", "fresh"}
_HEARTBEAT_AUTO_CONTEXT_THRESHOLD = 25
_HEARTBEAT_FALLBACK_MODES = {"none", "fresh"}
_HEARTBEAT_RECOVERY_FAILURE_TYPES = {"send_fail", "no_ack", "timeout", "blocked"}
_CONTEXT_LEFT_PATTERN_CACHE: dict[str, list[re.Pattern]] = {}
_HEARTBEAT_TRACE_MAX_LIMIT = 5000


def _normalize_heartbeat_session_mode(value: object) -> str:
    mode = str(value or "restore").strip().lower()
    if mode in _HEARTBEAT_SESSION_MODES:
        return mode
    return "restore"


def _get_compiled_context_left_patterns(launcher: str) -> list[re.Pattern]:
    provider_key = get_provider_key(launcher)
    cached = _CONTEXT_LEFT_PATTERN_CACHE.get(provider_key)
    if cached is not None:
        return cached

    compiled: list[re.Pattern] = []
    for raw in get_context_left_patterns(launcher):
        try:
            compiled.append(re.compile(str(raw), re.IGNORECASE))
        except Exception:
            continue

    _CONTEXT_LEFT_PATTERN_CACHE[provider_key] = compiled
    return compiled


def _extract_context_left_percent(output: str, *, launcher: str) -> Optional[int]:
    if not output:
        return None

    patterns = _get_compiled_context_left_patterns(launcher)
    if not patterns:
        return None

    for line in reversed(output.splitlines()):
        for pattern in patterns:
            match = pattern.search(line)
            if not match:
                continue
            captures = list(match.groups()) or [match.group(0)]
            for value in captures:
                try:
                    percent = int(str(value))
                except Exception:
                    continue
                if 0 <= percent <= 100:
                    return percent

    return None


def _detect_agent_context_left_percent(agent_id: str, *, launcher: str) -> Optional[int]:
    output = capture_output(agent_id, lines=220)
    if not output:
        return None
    return _extract_context_left_percent(output, launcher=launcher)


def _should_rollover_heartbeat_session(
    session_mode: str,
    context_left_percent: Optional[int],
    *,
    threshold: int = _HEARTBEAT_AUTO_CONTEXT_THRESHOLD,
) -> bool:
    if session_mode == "fresh":
        return True
    if session_mode != "auto":
        return False
    if context_left_percent is None:
        return False
    return context_left_percent < int(threshold)


def _write_heartbeat_handoff_template(repo_root: Path, agent_id: str, heartbeat_id: str) -> Path:
    state_dir = repo_root / '.claude' / 'state' / 'agent-manager' / 'heartbeat-handoffs' / agent_id
    state_dir.mkdir(parents=True, exist_ok=True)
    handoff_file = state_dir / f"{heartbeat_id}.md"
    template = (
        "# Heartbeat Session Handoff\n\n"
        f"- HB_ID: {heartbeat_id}\n"
        "- Status: pending\n\n"
        "## Current Objective\n- \n\n"
        "## Completed\n- \n\n"
        "## Pending / Blockers\n- \n\n"
        "## Next Action\n- \n\n"
        "## References\n- \n"
    )
    handoff_file.write_text(template, encoding='utf-8')
    return handoff_file


def _heartbeat_handoff_saved(handoff_file: Path) -> bool:
    try:
        content = handoff_file.read_text(encoding='utf-8')
    except Exception:
        return False
    stripped = content.strip()
    if not stripped:
        return False
    if 'Status: saved' in content:
        return True
    if 'Status: pending' not in content and len(stripped) >= 80:
        return True
    return False


def _build_heartbeat_handoff_prompt(handoff_file: Path, heartbeat_id: str) -> str:
    return (
        "Context is low. Before session rollover, persist a concise handoff.\n"
        f"Update file: {handoff_file}\n"
        "Requirements:\n"
        "1) Replace `Status: pending` with `Status: saved`.\n"
        "2) Fill sections: Current Objective, Completed, Pending / Blockers, Next Action, References.\n"
        "3) Keep it concise and actionable.\n"
        f"4) Then reply exactly: HEARTBEAT_HANDOFF_SAVED [HB_ID:{heartbeat_id}]"
    )


def _wait_for_idle_after_handoff(agent_id: str, launcher: str, timeout_seconds: int) -> str:
    deadline = time.time() + max(10, int(timeout_seconds))
    last_state = 'unknown'
    while time.time() < deadline:
        runtime = get_agent_runtime_state(agent_id, launcher=launcher)
        last_state = str(runtime.get('state', 'unknown'))
        if last_state == 'idle':
            return last_state
        if last_state in {'blocked', 'error', 'stuck'}:
            return last_state
        time.sleep(2)
    return last_state




def _heartbeat_audit_dir(repo_root: Path) -> Path:
    return repo_root / '.claude' / 'state' / 'agent-manager' / 'heartbeat-audit'


def _heartbeat_audit_file(repo_root: Path, agent_id: str) -> Path:
    safe_agent_id = str(agent_id or 'unknown').strip().lower() or 'unknown'
    safe_agent_id = re.sub(r'[^a-z0-9_-]+', '-', safe_agent_id)
    return _heartbeat_audit_dir(repo_root) / f"{safe_agent_id}.jsonl"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _parse_iso8601_utc(value: object) -> Optional[datetime]:
    text = str(value or '').strip()
    if not text:
        return None

    normalized = text
    if normalized.endswith('Z'):
        normalized = normalized[:-1] + '+00:00'

    try:
        parsed = datetime.fromisoformat(normalized)
    except Exception:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    return parsed


def _heartbeat_result(*, send_status: str, ack_status: str, failure_type: str) -> str:
    failure = str(failure_type or '').strip().lower()
    if failure:
        return 'failure'

    send = str(send_status or '').strip().lower()
    ack = str(ack_status or '').strip().lower()

    if send == 'ok' and ack == 'ack':
        return 'success'
    if send != 'ok':
        return 'failure'
    if ack in {'timeout', 'blocked', 'no_ack'}:
        return 'failure'
    if ack in {'not_checked', ''}:
        return 'pending'
    return 'unknown'


def _resolve_trace_agent_id(agent_value: Optional[str]) -> Optional[str]:
    if not agent_value:
        return None

    value = str(agent_value).strip()
    if not value:
        return None

    resolved = resolve_agent(value)
    if resolved:
        return get_agent_id(resolved)

    normalized = value.lower()
    if normalized.startswith('agent-'):
        normalized = normalized[len('agent-'):]
    return normalized.replace('_', '-')


def _resolve_trace_time_range(*, since_text: Optional[str], until_text: Optional[str]) -> tuple[Optional[datetime], Optional[datetime]]:
    since = _parse_iso8601_utc(since_text)
    until = _parse_iso8601_utc(until_text)

    if since_text and since is None:
        raise ValueError(f"Invalid --since timestamp: {since_text}")
    if until_text and until is None:
        raise ValueError(f"Invalid --until timestamp: {until_text}")
    if since and until and since > until:
        raise ValueError("Invalid time range: --since cannot be later than --until")

    return since, until


def _append_heartbeat_audit_event(
    repo_root: Path,
    *,
    agent_id: str,
    heartbeat_id: str,
    send_status: str,
    ack_status: str,
    duration_ms: int,
    context_left: Optional[int],
    failure_type: str = "",
    session_mode: str = "",
    phase: str = "",
    attempt: int = 0,
    recovery_action: str = "",
    timestamp: Optional[str] = None,
) -> Path:
    audit_file = _heartbeat_audit_file(repo_root, agent_id)
    audit_file.parent.mkdir(parents=True, exist_ok=True)

    duration_value = int(max(0, duration_ms))
    event = {
        'timestamp': timestamp or _utc_now_iso(),
        'agent_id': str(agent_id),
        'hb_id': str(heartbeat_id),
        'send_status': str(send_status),
        'ack_status': str(ack_status),
        'duration_ms': duration_value,
        'duration': duration_value,
        'context_left': context_left if isinstance(context_left, int) else None,
        'failure_type': str(failure_type or ''),
        'session_mode': str(session_mode or ''),
        'phase': str(phase or ''),
        'stage': str(phase or 'heartbeat_attempt'),
        'result': _heartbeat_result(send_status=send_status, ack_status=ack_status, failure_type=failure_type),
        'attempt': int(max(0, attempt)),
        'recovery_action': str(recovery_action or ''),
    }

    with audit_file.open('a', encoding='utf-8') as fp:
        fp.write(json.dumps(event, ensure_ascii=False) + "\n")
    return audit_file


def _read_heartbeat_audit_events(
    repo_root: Path,
    *,
    heartbeat_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = 20,
) -> list[dict]:
    trace_limit = max(1, min(_HEARTBEAT_TRACE_MAX_LIMIT, int(limit or 20)))
    audit_dir = _heartbeat_audit_dir(repo_root)
    if not audit_dir.exists() or not audit_dir.is_dir():
        return []

    hb_filter = str(heartbeat_id or '').strip()
    agent_filter = str(agent_id or '').strip().lower()

    files: list[Path]
    if agent_filter:
        files = [_heartbeat_audit_file(repo_root, agent_filter)]
    else:
        files = sorted(audit_dir.glob('*.jsonl'))

    events: list[dict] = []
    for path in files:
        if not path.exists() or not path.is_file():
            continue
        try:
            with path.open('r', encoding='utf-8') as fp:
                for line in fp:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except Exception:
                        continue
                    if not isinstance(payload, dict):
                        continue
                    if hb_filter and str(payload.get('hb_id', '')) != hb_filter:
                        continue
                    if agent_filter and str(payload.get('agent_id', '')).lower() != agent_filter:
                        continue

                    event_ts = _parse_iso8601_utc(payload.get('timestamp'))
                    if since and (event_ts is None or event_ts < since):
                        continue
                    if until and (event_ts is None or event_ts > until):
                        continue

                    events.append(payload)
        except Exception:
            continue

    events.sort(key=lambda item: str(item.get('timestamp', '')), reverse=True)
    return events[:trace_limit]


def cmd_heartbeat_trace(args) -> int:
    """Query heartbeat audit logs by HB_ID and/or agent."""
    repo_root = get_repo_root()

    try:
        since, until = _resolve_trace_time_range(
            since_text=getattr(args, 'since', None),
            until_text=getattr(args, 'until', None),
        )
    except ValueError as e:
        print(f"❌ {e}")
        return 1

    agent_id = _resolve_trace_agent_id(getattr(args, 'agent', None))

    events = _read_heartbeat_audit_events(
        repo_root,
        heartbeat_id=getattr(args, 'hb_id', None),
        agent_id=agent_id,
        since=since,
        until=until,
        limit=getattr(args, 'limit', 20),
    )

    if getattr(args, 'json', False):
        print(json.dumps(events, ensure_ascii=False, indent=2))
        return 0

    if not events:
        print("No heartbeat trace events found.")
        return 0

    print("🔎 Heartbeat Trace Events:")
    for event in events:
        timestamp = str(event.get('timestamp', 'unknown'))
        hb_id = str(event.get('hb_id', 'unknown'))
        event_agent = str(event.get('agent_id', 'unknown'))
        send_status = str(event.get('send_status', 'unknown'))
        ack_status = str(event.get('ack_status', 'unknown'))
        duration_ms = event.get('duration_ms')
        context_left = event.get('context_left')
        failure_type = str(event.get('failure_type', '') or '')
        stage = str(event.get('stage', event.get('phase', 'heartbeat_attempt')))
        result = str(event.get('result', _heartbeat_result(send_status=send_status, ack_status=ack_status, failure_type=failure_type)))

        duration_text = f"{duration_ms}ms" if isinstance(duration_ms, int) else 'n/a'
        context_text = f"{context_left}%" if isinstance(context_left, int) else 'unknown'
        failure_text = failure_type if failure_type else '-'
        print(
            f"- {timestamp} agent={event_agent} hb_id={hb_id} stage={stage} result={result} "
            f"send={send_status} ack={ack_status} duration={duration_text} "
            f"context_left={context_text} failure={failure_text}"
        )
    return 0


def cmd_heartbeat_slo(args) -> int:
    """Summarize heartbeat SLO metrics for daily/weekly windows."""
    from heartbeat_slo import build_slo_summary, format_slo_summary

    try:
        since, until = _resolve_trace_time_range(
            since_text=getattr(args, 'since', None),
            until_text=getattr(args, 'until', None),
        )
    except ValueError as e:
        print(f"❌ {e}")
        return 1

    agent_id = _resolve_trace_agent_id(getattr(args, 'agent', None))

    try:
        summary = build_slo_summary(
            repo_root=get_repo_root(),
            agent_id=agent_id,
            window=str(getattr(args, 'window', 'daily') or 'daily'),
            since=since,
            until=until,
        )
    except ValueError as e:
        print(f"❌ {e}")
        return 1

    if getattr(args, 'json', False):
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(format_slo_summary(summary))
    return 0


def _parse_non_negative_int(value: object, default: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        return int(default)
    return max(0, parsed)


def _parse_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if text in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return default


def _parse_heartbeat_recovery_policy(heartbeat: dict, args: Optional[argparse.Namespace] = None) -> dict:
    defaults = {
        'max_retries': 1,
        'retry_backoff_seconds': 3,
        'fallback_mode': 'fresh',
        'notify_on_failure': False,
        'notifier_channel': 'all',
    }

    recovery = heartbeat.get('recovery') if isinstance(heartbeat, dict) else {}
    raw = dict(recovery) if isinstance(recovery, dict) else {}

    for key in defaults.keys():
        if key in heartbeat and key not in raw:
            raw[key] = heartbeat.get(key)

    policy = {
        'max_retries': _parse_non_negative_int(raw.get('max_retries', defaults['max_retries']), defaults['max_retries']),
        'retry_backoff_seconds': _parse_non_negative_int(
            raw.get('retry_backoff_seconds', defaults['retry_backoff_seconds']),
            defaults['retry_backoff_seconds'],
        ),
        'fallback_mode': str(raw.get('fallback_mode', defaults['fallback_mode']) or defaults['fallback_mode']).strip().lower(),
        'notify_on_failure': _parse_bool(raw.get('notify_on_failure', defaults['notify_on_failure']), defaults['notify_on_failure']),
        'notifier_channel': str(raw.get('notifier_channel', defaults['notifier_channel']) or defaults['notifier_channel']).strip(),
    }

    if policy['fallback_mode'] == 'restart':
        policy['fallback_mode'] = 'fresh'
    if policy['fallback_mode'] not in _HEARTBEAT_FALLBACK_MODES:
        policy['fallback_mode'] = defaults['fallback_mode']

    if args is not None:
        if getattr(args, 'retry', None) is not None:
            policy['max_retries'] = _parse_non_negative_int(args.retry, policy['max_retries'])
        if getattr(args, 'backoff_seconds', None) is not None:
            policy['retry_backoff_seconds'] = _parse_non_negative_int(args.backoff_seconds, policy['retry_backoff_seconds'])
        if getattr(args, 'fallback_mode', None):
            fallback_mode = str(args.fallback_mode).strip().lower()
            if fallback_mode == 'restart':
                fallback_mode = 'fresh'
            if fallback_mode in _HEARTBEAT_FALLBACK_MODES:
                policy['fallback_mode'] = fallback_mode
        if getattr(args, 'notify_on_failure', None) is not None:
            policy['notify_on_failure'] = _parse_bool(args.notify_on_failure, policy['notify_on_failure'])
        if getattr(args, 'notifier_channel', None):
            policy['notifier_channel'] = str(args.notifier_channel).strip() or policy['notifier_channel']

    return policy


def _classify_heartbeat_ack(*, waited_for_ack: bool, last_state: Optional[str], timed_out: bool) -> tuple[str, str]:
    if not waited_for_ack:
        return 'not_checked', ''

    state = str(last_state or '').strip().lower()
    if state == 'idle':
        return 'ack', ''
    if state == 'blocked':
        return 'blocked', 'blocked'
    if timed_out:
        return 'timeout', 'timeout'
    return 'no_ack', 'no_ack'


def _should_retry_heartbeat_attempt(*, failure_type: str, attempt_index: int, max_retries: int) -> bool:
    if attempt_index >= max_retries:
        return False
    return str(failure_type or '').strip().lower() in _HEARTBEAT_RECOVERY_FAILURE_TYPES


def _resolve_notifier_script(repo_root: Path) -> Optional[Path]:
    candidates = [
        repo_root / '.agent' / 'skills' / 'notifier' / 'scripts' / 'notify.py',
        repo_root / '.claude' / 'skills' / 'notifier' / 'scripts' / 'notify.py',
        Path.home() / '.agent' / 'skills' / 'notifier' / 'scripts' / 'notify.py',
        Path.home() / '.claude' / 'skills' / 'notifier' / 'scripts' / 'notify.py',
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _notify_heartbeat_failure(
    repo_root: Path,
    *,
    channel: str,
    agent_name: str,
    agent_id: str,
    heartbeat_id: str,
    failure_type: str,
) -> bool:
    script = _resolve_notifier_script(repo_root)
    if not script:
        print("⚠️  notifier skill script not found; skip failure notification")
        return False

    message = (
        f"Heartbeat recovery failed for **{agent_name}** (`{agent_id}`).\n\n"
        f"- HB_ID: `{heartbeat_id}`\n"
        f"- Failure: `{failure_type or 'unknown'}`\n"
        f"- Action: manual investigation required"
    )

    cmd = [
        'python3',
        str(script),
        '--channel',
        channel or 'all',
        '--title',
        'Heartbeat Recovery Failed',
        '--message',
        message,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode == 0:
            print(f"📣 Failure notification sent via channel '{channel or 'all'}'")
            return True
        stderr = (result.stderr or '').strip()
        print(f"⚠️  notifier command failed (code={result.returncode})")
        if stderr:
            print(f"   {stderr}")
        return False
    except Exception as e:
        print(f"⚠️  notifier command error: {e}")
        return False


def _restart_heartbeat_session_fresh(agent_file_id: str, agent_name: str, agent_id: str) -> bool:
    print(f"♻️  Restarting '{agent_name}' with fresh session")
    stop_session(agent_id)
    time.sleep(1)

    restart_args = argparse.Namespace(
        agent=agent_file_id,
        working_dir=None,
        restore=False,
        tmux_layout='sessions',
    )
    if cmd_start(restart_args) != 0:
        print(f"❌ Failed to restart '{agent_name}'")
        return False
    time.sleep(2)
    return True


def _run_heartbeat_attempt(
    *,
    agent_id: str,
    agent_name: str,
    launcher: str,
    heartbeat_message: str,
    timeout_seconds: Optional[int],
    is_codex: bool,
) -> dict:
    started = time.time()

    if not send_keys(
        agent_id,
        heartbeat_message,
        send_enter=True,
        clear_input=is_codex,
        escape_first=is_codex,
        enter_via_key=is_codex,
    ):
        return {
            'send_status': 'fail',
            'ack_status': 'not_checked',
            'failure_type': 'send_fail',
            'last_state': None,
            'duration_ms': int((time.time() - started) * 1000),
        }

    print(f"✅ Heartbeat sent to {agent_name}")

    waited_for_ack = bool(timeout_seconds and timeout_seconds > 0)
    last_state: Optional[str] = None
    timed_out = False

    if waited_for_ack:
        start_time = time.time()
        poll_seconds = 2
        print(f"   Waiting for response (up to {int(timeout_seconds)}s)...")

        time.sleep(3)
        while (time.time() - start_time) < timeout_seconds:
            runtime = get_agent_runtime_state(agent_id, launcher=launcher)
            last_state = str(runtime.get('state', 'unknown'))

            if last_state == 'idle':
                break
            if last_state in ('blocked', 'error', 'stuck'):
                break
            time.sleep(poll_seconds)

        if last_state != 'idle' and (time.time() - start_time) >= timeout_seconds:
            timed_out = True

        time.sleep(1)
        tail = capture_output(agent_id, lines=50)
        if tail:
            print("----- Agent Output (tail) -----")
            print(tail.rstrip())
            print("----- End Agent Output -----")
        else:
            print("⚠️  Could not capture agent output")

    ack_status, failure_type = _classify_heartbeat_ack(
        waited_for_ack=waited_for_ack,
        last_state=last_state,
        timed_out=timed_out,
    )

    if last_state and last_state != 'idle':
        print(f"⚠️  Agent state after wait: {last_state}")

    return {
        'send_status': 'ok',
        'ack_status': ack_status,
        'failure_type': failure_type,
        'last_state': last_state,
        'duration_ms': int((time.time() - started) * 1000),
    }


def _maybe_rollover_heartbeat_session(
    *,
    agent_name: str,
    agent_id: str,
    agent_file_id: str,
    launcher: str,
    timeout_seconds: Optional[int],
    heartbeat_id: str,
    session_mode: str,
) -> Optional[Path]:
    if session_mode not in {'auto', 'fresh'}:
        return None

    context_left_percent = _detect_agent_context_left_percent(agent_id, launcher=launcher)
    if context_left_percent is not None:
        print(f"   Context left: {context_left_percent}%")
    elif session_mode == 'auto':
        print("   Context left: unknown (skip auto rollover)")

    if not _should_rollover_heartbeat_session(session_mode, context_left_percent):
        return None

    reason = 'fresh session_mode' if session_mode == 'fresh' else f'context<{_HEARTBEAT_AUTO_CONTEXT_THRESHOLD}%'
    print(f"♻️  Heartbeat session rollover triggered ({reason})")

    is_codex = 'codex' in (launcher or '').lower()
    repo_root = get_repo_root()
    handoff_file = _write_heartbeat_handoff_template(repo_root, agent_id, heartbeat_id)
    handoff_prompt = _build_heartbeat_handoff_prompt(handoff_file, heartbeat_id)

    if not send_keys(
        agent_id,
        handoff_prompt,
        send_enter=True,
        clear_input=is_codex,
        escape_first=is_codex,
        enter_via_key=is_codex,
    ):
        print("⚠️  Failed to send handoff prompt; skip rollover")
        return None

    handoff_timeout = min(180, max(45, int(timeout_seconds or 90)))
    state_after_handoff = _wait_for_idle_after_handoff(agent_id, launcher=launcher, timeout_seconds=handoff_timeout)
    saved = _heartbeat_handoff_saved(handoff_file)
    if not saved:
        print(f"⚠️  Handoff not saved (state={state_after_handoff}); skip rollover")
        return None

    print(f"✅ Handoff saved: {handoff_file}")

    if not stop_session(agent_id):
        print(f"⚠️  Failed to stop session for '{agent_name}'; skip rollover")
        return None

    time.sleep(1)
    restart_args = argparse.Namespace(
        agent=agent_file_id,
        working_dir=None,
        restore=False,
        tmux_layout='sessions',
    )
    if cmd_start(restart_args) != 0:
        print(f"⚠️  Failed to restart '{agent_name}' with fresh session")
        return None

    # Give the restarted TUI a brief moment before sending heartbeat.
    time.sleep(2)
    return handoff_file


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


def _heartbeat_audit_path(repo_root: Path, agent_id: str) -> Path:
    return repo_root / '.claude' / 'state' / 'agent-manager' / 'heartbeat-audit' / f"{agent_id}.jsonl"


def _load_recent_heartbeat_event(repo_root: Path, agent_id: str) -> Optional[dict]:
    audit_file = _heartbeat_audit_path(repo_root, agent_id)
    if not audit_file.exists():
        return None

    try:
        lines = audit_file.read_text(encoding='utf-8').splitlines()
    except Exception:
        return None

    for raw in reversed(lines):
        line = raw.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception:
            continue
        if isinstance(payload, dict):
            return payload

    return None


def _extract_recent_hb_id_from_output(output: str) -> str:
    if not output:
        return ""

    inline_matches = re.findall(r"\[HB_ID:([A-Za-z0-9_-]+)\]", output)
    if inline_matches:
        return str(inline_matches[-1])

    plain_matches = re.findall(r"HB_ID:\s*([A-Za-z0-9_-]+)", output)
    if plain_matches:
        return str(plain_matches[-1])

    return ""


def cmd_status(args):
    """Show status for one agent."""
    if not check_tmux():
        print("❌ tmux is not installed")
        return 1

    agent_config = resolve_agent(args.agent)
    if not agent_config:
        print(f"❌ Agent not found: {args.agent}")
        return 1

    agent_name = agent_config['name']
    agent_id = get_agent_id(agent_config)
    enabled = bool(agent_config.get('enabled', True))
    running = session_exists(agent_id)
    launcher = resolve_launcher_command(agent_config.get('launcher', ''))

    session_info = get_session_info(agent_id) if running else None
    session_name = session_info.get('session', f"agent-{agent_id}") if session_info else f"agent-{agent_id}"

    if running:
        runtime = get_agent_runtime_state(agent_id, launcher=launcher)
    else:
        runtime = {'state': 'stopped'}

    runtime_state = str(runtime.get('state', 'unknown'))
    runtime_reason = str(runtime.get('reason', '')).strip()
    elapsed_seconds = runtime.get('elapsed_seconds')

    recent_heartbeat = "none"
    recent_heartbeat_detail = ""

    repo_root = get_repo_root()
    event = _load_recent_heartbeat_event(repo_root, agent_id)
    if event:
        hb_id = str(event.get('hb_id') or '').strip()
        timestamp = str(event.get('timestamp') or '').strip()
        send_status = str(event.get('send_status') or 'unknown').strip()
        ack_status = str(event.get('ack_status') or 'unknown').strip()
        if hb_id and timestamp:
            recent_heartbeat = f"{hb_id} ({timestamp})"
        elif hb_id:
            recent_heartbeat = hb_id
        else:
            recent_heartbeat = "recorded (missing hb_id)"
        recent_heartbeat_detail = f"send={send_status} ack={ack_status}"
    elif running:
        tail = capture_output(agent_id, lines=220) or ""
        hb_id = _extract_recent_hb_id_from_output(tail)
        if hb_id:
            recent_heartbeat = f"{hb_id} (from tmux output)"

    print(f"📌 Status: {agent_name}")
    print(f"   Agent ID: {agent_id}")
    print(f"   Enabled: {'yes' if enabled else 'no'}")
    print(f"   Running: {'yes' if running else 'no'}")
    print(f"   Session: {session_name}({agent_name})" if running else f"   Session: {session_name} (not running)")
    print(f"   Runtime state: {runtime_state}")
    if runtime_reason:
        print(f"   Runtime reason: {runtime_reason}")
    if elapsed_seconds is not None:
        print(f"   Runtime elapsed: {elapsed_seconds}s")
    print(f"   Recent heartbeat: {recent_heartbeat}")
    if recent_heartbeat_detail:
        print(f"   Heartbeat detail: {recent_heartbeat_detail}")

    return 0


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


def _tmux_install_hint() -> str:
    if sys.platform == 'darwin':
        return 'brew install tmux'
    if sys.platform.startswith('linux'):
        return 'sudo apt install tmux'
    return 'Install tmux and ensure it is on PATH'


def cmd_doctor(args):
    """Run basic environment checks for agent-manager."""
    repo_root = get_repo_root()
    agents_dir = repo_root / 'agents'
    skills_dir = repo_root / '.agent' / 'skills'
    claude_dir = repo_root / '.claude'

    problems = 0

    print("🩺 agent-manager doctor")
    print()
    print(f"Repo root: {repo_root}")
    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    print(f"Platform: {sys.platform}")
    print()

    if check_tmux():
        print("✅ tmux: found")
    else:
        problems += 1
        print("❌ tmux: missing")
        print(f"   Fix: {_tmux_install_hint()}")

    if agents_dir.exists() and agents_dir.is_dir():
        agents = list_all_agents(agents_dir)
        print(f"✅ agents/: found ({len(agents)} configured)")
    else:
        problems += 1
        print("❌ agents/: missing")
        print(f"   Expected at: {agents_dir}")

    if skills_dir.exists() and skills_dir.is_dir():
        print("✅ .agent/skills/: found")
    else:
        print("⚠️  .agent/skills/: missing")
        print(f"   Expected at: {skills_dir}")

    if claude_dir.exists() and claude_dir.is_dir():
        print("✅ .claude/: found")
    else:
        print("⚠️  .claude/: missing")
        print(f"   Expected at: {claude_dir}")

    try:
        result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
        if result.returncode == 0:
            print("✅ crontab: readable")
        else:
            # macOS exits non-zero when no crontab exists; treat as warning.
            print("⚠️  crontab: not set (or not readable)")
    except FileNotFoundError:
        problems += 1
        print("❌ crontab: command not found")

    if args.deep and agents_dir.exists() and agents_dir.is_dir():
        print()
        print("🔎 Deep checks:")
        agents = list_all_agents(agents_dir)
        for file_id, config in sorted(agents.items(), key=lambda item: item[0]):
            agent_id = get_agent_id(config)
            working_dir = config.get('working_directory')
            launcher = resolve_launcher_command(config.get('launcher', ''))
            enabled = config.get('enabled', True)

            status = "✅" if enabled else "⛔"
            print(f"{status} {file_id} (agent-{agent_id})")
            if working_dir:
                wd_ok = Path(working_dir).exists()
                print(f"   Working dir: {working_dir} ({'ok' if wd_ok else 'missing'})")
                if not wd_ok and enabled:
                    problems += 1
            else:
                print("   Working dir: (not set)")
                if enabled:
                    problems += 1

            if launcher:
                print(f"   Launcher: {launcher}")
            else:
                print("   Launcher: (not set)")

    print()
    if problems:
        print(f"❌ Doctor found {problems} problem(s)")
        return 1
    print("✅ Doctor checks passed")
    return 0


def _lifecycle_deps_module():
    return sys.modules[__name__]


def cmd_start(args):
    """Start an agent in tmux session."""
    return lifecycle_cmd_start(args, deps=_lifecycle_deps_module())


def cmd_stop(args):
    """Stop a running agent."""
    return lifecycle_cmd_stop(args, deps=_lifecycle_deps_module())


def cmd_monitor(args):
    """Monitor agent output."""
    return lifecycle_cmd_monitor(args, deps=_lifecycle_deps_module())


def cmd_send(args):
    """Send message to agent."""
    return lifecycle_cmd_send(args, deps=_lifecycle_deps_module())


def cmd_assign(args):
    """Assign task to agent."""
    return lifecycle_cmd_assign(args, deps=_lifecycle_deps_module(), start_handler=cmd_start)


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


def cmd_heartbeat(args):
    """Handle heartbeat subcommands."""
    from schedule_helper import list_heartbeats_formatted, sync_crontab

    if args.heartbeat_command == 'list':
        print(list_heartbeats_formatted())
        return 0

    elif args.heartbeat_command == 'sync':
        # Reuse sync_crontab - it handles both schedules and heartbeats
        result = sync_crontab(dry_run=args.dry_run)

        if args.dry_run:
            print("🔍 Dry run - would sync the following to crontab:")
            print()
            if result['content']:
                print(result['content'])
            else:
                print("(no heartbeats configured)")
            return 0

        if result['success']:
            print(f"✅ Crontab synced successfully")
            entries = result.get('entries', 0)
            added = result.get('added', 0)
            removed = result.get('removed', 0)
            print(f"   {entries} entries configured (schedules + heartbeats)")
            if added or removed:
                print(f"   Changes: +{added} -{removed}")
        else:
            print(f"❌ Failed to sync crontab")
            return 1

        return 0

    elif args.heartbeat_command == 'run':
        return cmd_heartbeat_run(args)

    elif args.heartbeat_command == 'trace':
        return cmd_heartbeat_trace(args)

    elif args.heartbeat_command == 'slo':
        return cmd_heartbeat_slo(args)

    else:
        print(f"Unknown heartbeat command: {args.heartbeat_command}")
        return 1


def cmd_heartbeat_run(args):
    """Run a heartbeat check for an agent."""
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
    agent_file_id = agent_config.get('file_id', args.agent)

    # Check if agent is disabled
    if not agent_config.get('enabled', True):
        agent_file_path = agent_config.get('_file_path', f'agents/{agent_file_id}.md')
        print(f"⏭️  Agent '{agent_name}' is disabled - skipping heartbeat")
        print(f"   Config: {agent_file_path}")
        return 0

    # Get heartbeat config
    heartbeat = agent_config.get('heartbeat')
    if not heartbeat or not isinstance(heartbeat, dict):
        print(f"❌ No heartbeat configured for agent '{agent_name}'")
        return 1

    # Check if heartbeat is disabled
    if not heartbeat.get('enabled', True):
        print(f"⏭️  Heartbeat is disabled for agent '{agent_name}'")
        return 0

    # Heartbeats only check running agents - don't start if not running
    if not session_exists(agent_id):
        print(f"⏭️  Agent '{agent_name}' is not running - skipping heartbeat")
        return 0

    # Parse timeout
    timeout_seconds = None
    timeout_str = args.timeout or heartbeat.get('max_runtime', '')
    if timeout_str:
        timeout_seconds = parse_duration(timeout_str)

    print(f"💓 Heartbeat: {agent_name}")
    print(f"   Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    heartbeat_started_at = time.time()

    repo_root = get_repo_root()
    launcher = resolve_launcher_command(agent_config.get('launcher', ''))
    is_codex = 'codex' in launcher.lower()
    context_left_percent = _detect_agent_context_left_percent(agent_id, launcher=launcher)

    session_mode_raw = heartbeat.get('session_mode', 'restore')
    session_mode = _normalize_heartbeat_session_mode(session_mode_raw)
    if str(session_mode_raw).strip().lower() not in _HEARTBEAT_SESSION_MODES:
        print(f"⚠️  Unknown heartbeat session_mode '{session_mode_raw}', fallback to 'restore'")
    print(f"   Session mode: {session_mode}")

    recovery_policy = _parse_heartbeat_recovery_policy(heartbeat, args)
    print(
        "   Recovery policy: "
        f"retry={recovery_policy['max_retries']} "
        f"backoff={recovery_policy['retry_backoff_seconds']}s "
        f"fallback={recovery_policy['fallback_mode']} "
        f"notify={recovery_policy['notify_on_failure']}"
    )

    # Standard heartbeat message (with traceable id for delivery debugging)
    heartbeat_id = time.strftime('%Y%m%d-%H%M%S')
    print(f"   HB_ID: {heartbeat_id}")

    rollover_handoff_file = _maybe_rollover_heartbeat_session(
        agent_name=agent_name,
        agent_id=agent_id,
        agent_file_id=agent_file_id,
        launcher=launcher,
        timeout_seconds=timeout_seconds,
        heartbeat_id=heartbeat_id,
        session_mode=session_mode,
    )

    heartbeat_message = (
        "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. "
        "Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK. "
        f"[HB_ID:{heartbeat_id}]"
    )
    if rollover_handoff_file is not None:
        heartbeat_message = (
            f"First read rollover handoff file: {rollover_handoff_file}.\n"
            + heartbeat_message
        )


    max_retries = int(recovery_policy['max_retries'])
    backoff_seconds = int(recovery_policy['retry_backoff_seconds'])
    fallback_mode = str(recovery_policy['fallback_mode'])
    notify_on_failure = bool(recovery_policy['notify_on_failure'])
    notifier_channel = str(recovery_policy['notifier_channel'] or 'all')

    final_attempt_result: Optional[dict] = None
    recovery_action = ''

    for attempt in range(max_retries + 1):
        attempt_no = attempt + 1
        print(f"   Attempt {attempt_no}/{max_retries + 1}")
        result = _run_heartbeat_attempt(
            agent_id=agent_id,
            agent_name=agent_name,
            launcher=launcher,
            heartbeat_message=heartbeat_message,
            timeout_seconds=timeout_seconds,
            is_codex=is_codex,
        )

        send_status = str(result.get('send_status', 'fail'))
        ack_status = str(result.get('ack_status', 'not_checked'))
        failure_type = str(result.get('failure_type', ''))
        duration_ms = int(result.get('duration_ms', 0) or 0)

        _append_heartbeat_audit_event(
            repo_root,
            agent_id=agent_id,
            heartbeat_id=heartbeat_id,
            send_status=send_status,
            ack_status=ack_status,
            duration_ms=duration_ms,
            context_left=context_left_percent,
            failure_type=failure_type,
            session_mode=session_mode,
            phase='attempt',
            attempt=attempt_no,
            recovery_action=recovery_action,
        )

        final_attempt_result = result

        if send_status == 'ok' and ack_status in {'ack', 'not_checked'}:
            break

        if _should_retry_heartbeat_attempt(
            failure_type=failure_type,
            attempt_index=attempt,
            max_retries=max_retries,
        ):
            if backoff_seconds > 0:
                print(f"   Retry backoff: {backoff_seconds}s")
                time.sleep(backoff_seconds)
            continue
        break

    if final_attempt_result is None:
        print("❌ Heartbeat failed before execution")
        return 1

    send_status = str(final_attempt_result.get('send_status', 'fail'))
    ack_status = str(final_attempt_result.get('ack_status', 'not_checked'))
    failure_type = str(final_attempt_result.get('failure_type', ''))

    if send_status == 'ok' and ack_status in {'ack', 'not_checked'}:
        print("✅ Heartbeat completed successfully")
        return 0

    if fallback_mode == 'fresh':
        recovery_action = 'fallback_fresh'
        print(f"⚠️  Heartbeat unresolved (failure={failure_type or 'unknown'}), applying fallback: fresh")
        if _restart_heartbeat_session_fresh(agent_file_id, agent_name, agent_id):
            fallback_result = _run_heartbeat_attempt(
                agent_id=agent_id,
                agent_name=agent_name,
                launcher=launcher,
                heartbeat_message=heartbeat_message,
                timeout_seconds=timeout_seconds,
                is_codex=is_codex,
            )
            send_status = str(fallback_result.get('send_status', 'fail'))
            ack_status = str(fallback_result.get('ack_status', 'not_checked'))
            failure_type = str(fallback_result.get('failure_type', ''))
            duration_ms = int(fallback_result.get('duration_ms', 0) or 0)
            _append_heartbeat_audit_event(
                repo_root,
                agent_id=agent_id,
                heartbeat_id=heartbeat_id,
                send_status=send_status,
                ack_status=ack_status,
                duration_ms=duration_ms,
                context_left=context_left_percent,
                failure_type=failure_type,
                session_mode='fresh',
                phase='fallback',
                attempt=max_retries + 2,
                recovery_action=recovery_action,
            )
        else:
            send_status = 'fail'
            ack_status = 'no_ack'
            if not failure_type:
                failure_type = 'timeout'

    if send_status == 'ok' and ack_status in {'ack', 'not_checked'}:
        print("✅ Heartbeat recovered via fallback policy")
        return 0

    if notify_on_failure:
        _notify_heartbeat_failure(
            repo_root,
            channel=notifier_channel,
            agent_name=agent_name,
            agent_id=agent_id,
            heartbeat_id=heartbeat_id,
            failure_type=failure_type,
        )

    print(f"❌ Heartbeat failed after recovery policy (failure={failure_type or 'unknown'})")
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

    # If the schedule points to a task file, keep a resolved path so we can reference it
    # directly (more reliable for TUIs than pasting the full content).
    schedule_task_path: Optional[Path] = None
    if not str(schedule.get('task') or '').strip():
        raw_task_file = str(schedule.get('task_file') or '').strip()
        if raw_task_file:
            raw_task_file = expand_env_vars(raw_task_file)
            path = Path(raw_task_file)
            if not path.is_absolute():
                path = repo_root / path
            if path.exists():
                schedule_task_path = path

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
            working_dir=None,
            restore=False,
        )

        if cmd_start(start_args) != 0:
            print(f"❌ Failed to start agent")
            return 1

        was_started = True
        time.sleep(2)

    # Check if agent is busy (processing previous task). For long-running stuck/error
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

    if state == 'blocked':
        # Blocked usually means the agent is waiting for user approval/input; restarting
        # would lose context and won't unblock the workflow.
        print(f"⏭️  Agent is blocked, skipping scheduled task")
        print(f"   Will retry on next cron execution")
        return 0
    if state == 'error':
        reason = str(runtime.get('reason', 'unknown'))
        if not _restart_agent(f"error:{reason}"):
            return 1
    elif state == 'stuck':
        restart_threshold = timeout_seconds if timeout_seconds else 900
        if isinstance(elapsed, int) and elapsed >= restart_threshold:
            if not _restart_agent(f"stuck>{restart_threshold}s"):
                return 1
        else:
            print(f"⏭️  Agent appears stuck but below restart threshold; skipping scheduled task")
            print(f"   Will retry on next cron execution")
            return 0
    elif state == 'busy':
        should_restart = False
        if timeout_seconds and isinstance(elapsed, int) and elapsed >= timeout_seconds:
            should_restart = True

        if should_restart:
            if not _restart_agent(f"busy>{timeout_seconds}s"):
                return 1
        else:
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

    # Wait for agent to be idle before sending the scheduled task.
    # This prevents the task from being queued with the startup prompt.
    if not was_started and not did_restart:
        idle_wait_seconds = 5
        deadline = time.time() + idle_wait_seconds
        while time.time() < deadline:
            runtime_check = get_agent_runtime_state(agent_id, launcher=launcher)
            if str(runtime_check.get('state', 'unknown')) == 'idle':
                break
            time.sleep(0.5)

    # Send the task.
    # Note: Codex TUI can be unreliable with very large multi-line pastes; prefer a file pointer.
    provider_key = get_provider_key(launcher)
    task_message = task
    if provider_key == 'codex':
        # Prefer referencing the original schedule task_file (e.g. agents/EMP_0001/prompt/team-monitor.md)
        # to avoid large multi-line pastes in the Codex TUI.
        if schedule_task_path is not None:
            task_message = (
                f"Run scheduled job '{args.job}'. Read and follow instructions from file: {schedule_task_path}"
            )
        # Fallback for inline schedules with large multi-line tasks.
        elif _should_use_codex_file_pointer(task_message):
            task_file = write_scheduled_task_file(repo_root, agent_id, args.job, task_message)
            task_message = (
                f"Run scheduled job '{args.job}'. Read and follow instructions from file: {task_file}"
            )

    is_codex = provider_key == 'codex'
    if not send_keys(
        agent_id,
        task_message,
        send_enter=True,
        clear_input=is_codex,
        escape_first=is_codex,
        enter_via_key=is_codex,
    ):
        print(f"❌ Failed to send task to agent")
        return 1

    print(f"✅ Task sent to {agent_name}")

    # Best-effort: wait for the agent to finish and print a tail of its output.
    # Cron captures stdout/stderr to the log file, so this makes scheduled jobs
    # actually useful (they include the generated report).
    wait_seconds = timeout_seconds if timeout_seconds else 600
    if wait_seconds and wait_seconds > 0:
        start_time = time.time()
        last_state: Optional[str] = None
        poll_seconds = 2

        # First, wait briefly for the agent to actually start processing the message.
        # Some TUIs report "idle" immediately after keystroke injection.
        start_deadline = min(30, int(wait_seconds))
        while (time.time() - start_time) < start_deadline:
            runtime = get_agent_runtime_state(agent_id, launcher=launcher)
            last_state = str(runtime.get('state', 'unknown'))
            if last_state != 'idle':
                break
            time.sleep(1)

        print(f"   Waiting for completion (up to {int(wait_seconds)}s)...")
        while (time.time() - start_time) < wait_seconds:
            runtime = get_agent_runtime_state(agent_id, launcher=launcher)
            last_state = str(runtime.get('state', 'unknown'))

            if last_state == 'idle':
                break

            # If we hit a non-idle terminal state, stop waiting and log output.
            if last_state in ('blocked', 'error', 'stuck'):
                break

            time.sleep(poll_seconds)

        # Give the TUI a moment to flush output.
        time.sleep(1)
        tail = capture_output(agent_id, lines=200)
        if tail:
            print("----- Agent Output (tail) -----")
            print(tail.rstrip())
            print("----- End Agent Output -----")
        else:
            print("⚠️  Could not capture agent output")

        if last_state and last_state != 'idle':
            print(f"⚠️  Agent state after wait: {last_state}")

    # If timeout specified, wait and then stop
    if timeout_seconds and was_started:
        print(f"   Will auto-stop after {timeout_str}")
        # Note: In a real implementation, you might want to monitor
        # the agent's completion status rather than just waiting.
        # For now, we just log and let cron handle the next invocation.

    return 0


def main():
    parser = create_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 0
    handlers = get_command_handlers(
        cmd_list=cmd_list,
        cmd_doctor=cmd_doctor,
        cmd_start=cmd_start,
        cmd_stop=cmd_stop,
        cmd_status=cmd_status,
        cmd_monitor=cmd_monitor,
        cmd_send=cmd_send,
        cmd_assign=cmd_assign,
        cmd_schedule=cmd_schedule,
        cmd_heartbeat=cmd_heartbeat,
    )

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
