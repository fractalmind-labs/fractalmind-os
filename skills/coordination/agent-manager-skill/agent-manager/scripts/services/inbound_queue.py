from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional


_PENDING_STATES = {'queued', 'claimed', 'dispatching', 'dispatch_failed', 'failed'}


def _queue_file(repo_root: Path, agent_id: str) -> Path:
    return repo_root / '.claude' / 'state' / 'agent-manager' / 'inbound-queue' / f'{agent_id}.jsonl'


def _append_event(repo_root: Path, agent_id: str, payload: Dict[str, Any]) -> None:
    queue_file = _queue_file(repo_root, agent_id)
    queue_file.parent.mkdir(parents=True, exist_ok=True)
    with queue_file.open('a', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def append_inbound_message_event(
    repo_root: Path,
    *,
    agent_id: str,
    message_id: str,
    event: str,
    state: Optional[str] = None,
    detail: str = "",
    **extra: Any,
) -> None:
    payload: Dict[str, Any] = {
        'message_id': str(message_id),
        'agent_id': str(agent_id),
        'event': str(event),
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    if state is not None:
        payload['state'] = str(state)
    if detail:
        payload['detail'] = str(detail)
    for key, value in extra.items():
        payload[str(key)] = value
    _append_event(repo_root, agent_id, payload)


def enqueue_inbound_message(
    repo_root: Path,
    *,
    agent_id: str,
    source: str,
    message_kind: str,
    message: str,
) -> str:
    message_id = f"msg-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    base = {
        'message_id': message_id,
        'agent_id': str(agent_id),
        'source': str(source),
        'message_kind': str(message_kind),
        'message': str(message),
    }
    append_inbound_message_event(
        repo_root,
        agent_id=agent_id,
        message_id=message_id,
        event='received',
        state='received',
        source=source,
        message_kind=message_kind,
        message=message,
        received_at=timestamp,
    )
    append_inbound_message_event(
        repo_root,
        agent_id=agent_id,
        message_id=message_id,
        event='queued',
        state='queued',
        source=source,
        message_kind=message_kind,
        message=message,
    )
    return message_id


def mark_inbound_message_state(
    repo_root: Path,
    *,
    agent_id: str,
    message_id: str,
    state: str,
    detail: str = "",
    **extra: Any,
) -> None:
    append_inbound_message_event(
        repo_root,
        agent_id=agent_id,
        message_id=message_id,
        event=str(state),
        state=str(state),
        detail=detail,
        **extra,
    )


def read_inbound_events(
    repo_root: Path,
    *,
    agent_id: str,
    message_id: Optional[str] = None,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    queue_file = _queue_file(repo_root, agent_id)
    if not queue_file.exists():
        return []

    events: List[Dict[str, Any]] = []
    with queue_file.open('r', encoding='utf-8') as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            if message_id and str(payload.get('message_id') or '') != str(message_id):
                continue
            events.append(payload)

    events.sort(key=lambda item: str(item.get('timestamp') or ''))
    if limit is not None:
        return events[-max(0, int(limit)) :]
    return events


def was_message_yielded(repo_root: Path, *, agent_id: str, message_id: str) -> bool:
    return any(
        str(event.get('event') or '') == 'yielded'
        for event in read_inbound_events(repo_root, agent_id=agent_id, message_id=message_id)
    )


def note_pending_messages_yielded(
    repo_root: Path,
    *,
    agent_id: str,
    heartbeat_id: str,
    reason_code: str,
    detail: str = "",
) -> List[str]:
    pending = load_pending_inbound_messages(repo_root, agent_id=agent_id)
    yielded_ids: List[str] = []
    for payload in pending:
        message_id = str(payload.get('message_id') or '').strip()
        if not message_id:
            continue
        append_inbound_message_event(
            repo_root,
            agent_id=agent_id,
            message_id=message_id,
            event='yielded',
            state=str(payload.get('state') or 'queued'),
            detail=detail,
            heartbeat_id=heartbeat_id,
            reason_code=reason_code,
        )
        yielded_ids.append(message_id)
    return yielded_ids


def load_pending_inbound_messages(repo_root: Path, *, agent_id: str) -> List[Dict[str, Any]]:
    latest: Dict[str, Dict[str, Any]] = {}
    for payload in read_inbound_events(repo_root, agent_id=agent_id):
        message_id = str(payload.get('message_id') or '').strip()
        if not message_id:
            continue
        current = latest.get(message_id, {})
        merged = dict(current)
        merged.update(payload)
        latest[message_id] = merged

    pending = [payload for payload in latest.values() if str(payload.get('state') or '') in _PENDING_STATES]
    pending.sort(key=lambda item: str(item.get('timestamp') or ''))
    return pending


def has_pending_inbound_messages(repo_root: Path, *, agent_id: str) -> bool:
    return bool(load_pending_inbound_messages(repo_root, agent_id=agent_id))
