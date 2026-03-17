from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List


_PENDING_STATES = {'queued', 'dispatching', 'dispatch_failed'}


def _queue_file(repo_root: Path, agent_id: str) -> Path:
    return repo_root / '.claude' / 'state' / 'agent-manager' / 'inbound-queue' / f'{agent_id}.jsonl'


def _append_event(repo_root: Path, agent_id: str, payload: Dict[str, Any]) -> None:
    queue_file = _queue_file(repo_root, agent_id)
    queue_file.parent.mkdir(parents=True, exist_ok=True)
    with queue_file.open('a', encoding='utf-8') as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


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
        'timestamp': timestamp,
    }
    _append_event(repo_root, agent_id, {**base, 'event': 'received', 'state': 'received'})
    _append_event(repo_root, agent_id, {**base, 'event': 'queued', 'state': 'queued'})
    return message_id


def mark_inbound_message_state(
    repo_root: Path,
    *,
    agent_id: str,
    message_id: str,
    state: str,
    detail: str = "",
) -> None:
    _append_event(
        repo_root,
        agent_id,
        {
            'message_id': str(message_id),
            'agent_id': str(agent_id),
            'event': str(state),
            'state': str(state),
            'detail': str(detail),
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        },
    )


def load_pending_inbound_messages(repo_root: Path, *, agent_id: str) -> List[Dict[str, Any]]:
    queue_file = _queue_file(repo_root, agent_id)
    if not queue_file.exists():
        return []

    latest: Dict[str, Dict[str, Any]] = {}
    with queue_file.open('r', encoding='utf-8') as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except Exception:
                continue
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
