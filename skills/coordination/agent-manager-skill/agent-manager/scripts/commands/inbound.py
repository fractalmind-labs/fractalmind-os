from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .lifecycle import _confirm_delivery_after_send


_DISPATCH_LEASE_SECONDS = 300
_RETRY_BACKOFF_SECONDS = 60
_MAX_REPLAY_ATTEMPTS = 3
_RETRYABLE_STATES = {'queued', 'dispatch_failed', 'failed'}
_LEASED_STATES = {'claimed', 'dispatching'}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_utc_timestamp(value: object) -> Optional[datetime]:
    text = str(value or '').strip()
    if not text:
        return None

    normalized = text[:-1] + '+00:00' if text.endswith('Z') else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except Exception:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _attempt_count(payload: Dict[str, Any]) -> int:
    try:
        return max(0, int(payload.get('attempt_count') or 0))
    except Exception:
        return 0


def _next_retry_due(payload: Dict[str, Any], *, now: datetime) -> bool:
    next_retry_at = _parse_utc_timestamp(payload.get('next_retry_at'))
    return next_retry_at is None or next_retry_at <= now


def _lease_expired(payload: Dict[str, Any], *, now: datetime) -> bool:
    lease_anchor = (
        _parse_utc_timestamp(payload.get('claimed_at'))
        or _parse_utc_timestamp(payload.get('dispatching_at'))
        or _parse_utc_timestamp(payload.get('timestamp'))
    )
    if lease_anchor is None:
        return True
    return now >= lease_anchor + timedelta(seconds=_DISPATCH_LEASE_SECONDS)


def _is_replayable(payload: Dict[str, Any], *, now: datetime) -> bool:
    state = str(payload.get('state') or '').strip()
    attempts = _attempt_count(payload)

    if attempts >= _MAX_REPLAY_ATTEMPTS:
        return False
    if state in _RETRYABLE_STATES:
        return _next_retry_due(payload, now=now)
    if state in _LEASED_STATES:
        return _lease_expired(payload, now=now)
    return False


def _build_replay_message(
    deps: Any,
    *,
    repo_root: Path,
    agent_id: str,
    payload: Dict[str, Any],
    is_codex: bool,
) -> str:
    message = str(payload.get('message') or '')
    source = str(payload.get('source') or '')
    message_kind = str(payload.get('message_kind') or '')

    if message_kind == 'task_assignment' or source == 'assign':
        task_message = f"# Task Assignment\n\n{message}"
        if is_codex and deps._should_use_codex_file_pointer(task_message):
            task_file = deps.write_codex_message_file(repo_root, agent_id, 'assign-replay', task_message)
            return (
                f"Task assignment replayed from inbound queue. Read and follow instructions from file: {task_file}\n"
                "Execute the task now and report progress/blocks."
            )
        return task_message

    if is_codex and deps._should_use_codex_file_pointer(message):
        message_file = deps.write_codex_message_file(repo_root, agent_id, 'send-replay', message)
        return (
            f"Inbound message replayed from queue. Read and execute the message from file: {message_file}\n"
            "After completing it, summarize key results."
        )
    return message


def drain_main_inbound_once(
    *,
    deps: Any,
    agent_id: str = 'main',
    trigger: str = 'manual',
) -> Dict[str, int]:
    repo_root = deps.get_repo_root()
    pending = deps.load_pending_inbound_messages(repo_root, agent_id=agent_id)
    if not pending:
        return {'rc': 0, 'drained': 0, 'skipped': 0, 'failed': 0, 'dead_lettered': 0}

    agent_config = deps.resolve_agent(agent_id)
    if not agent_config:
        print(f"❌ Agent not found: {agent_id}")
        return {'rc': 1, 'drained': 0, 'skipped': 0, 'failed': 0, 'dead_lettered': 0}

    if not deps.check_tmux():
        print("❌ tmux is not installed")
        return {'rc': 1, 'drained': 0, 'skipped': 0, 'failed': 0, 'dead_lettered': 0}

    if not deps.session_exists(agent_id):
        print(f"⚠️  Agent '{agent_config['name']}' is not running; inbound drain skipped")
        return {'rc': 1, 'drained': 0, 'skipped': len(pending), 'failed': 0, 'dead_lettered': 0}

    launcher = deps.resolve_launcher_command(agent_config.get('launcher', ''))
    is_codex = 'codex' in launcher.lower()
    claim_owner = f"inbound-drain:{trigger}"
    now = _utc_now()
    summary = {'rc': 0, 'drained': 0, 'skipped': 0, 'failed': 0, 'dead_lettered': 0}

    for payload in pending:
        message_id = str(payload.get('message_id') or '').strip()
        if not message_id:
            summary['skipped'] += 1
            continue

        attempts = _attempt_count(payload)
        if attempts >= _MAX_REPLAY_ATTEMPTS:
            deps.mark_inbound_message_state(
                repo_root,
                agent_id=agent_id,
                message_id=message_id,
                state='dead_letter',
                detail='replay_attempt_limit_exceeded',
                attempt_count=attempts,
            )
            summary['dead_lettered'] += 1
            continue

        if not _is_replayable(payload, now=now):
            summary['skipped'] += 1
            continue

        next_attempt = attempts + 1
        if deps.was_message_yielded(repo_root, agent_id=agent_id, message_id=message_id):
            deps.append_inbound_message_event(
                repo_root,
                agent_id=agent_id,
                message_id=message_id,
                event='resumed',
                state=str(payload.get('state') or 'queued'),
                detail=f"inbound_drain_resumed:{trigger}",
                attempt_count=next_attempt,
            )

        claimed_at = _utc_now().isoformat().replace('+00:00', 'Z')
        deps.mark_inbound_message_state(
            repo_root,
            agent_id=agent_id,
            message_id=message_id,
            state='claimed',
            detail=f"inbound_drain_claimed:{trigger}",
            claim_owner=claim_owner,
            claimed_at=claimed_at,
            attempt_count=next_attempt,
        )
        deps.mark_inbound_message_state(
            repo_root,
            agent_id=agent_id,
            message_id=message_id,
            state='dispatching',
            detail='inbound_drain_dispatch_start',
            claim_owner=claim_owner,
            claimed_at=claimed_at,
            dispatching_at=claimed_at,
            attempt_count=next_attempt,
        )

        replay_message = _build_replay_message(
            deps,
            repo_root=repo_root,
            agent_id=agent_id,
            payload=payload,
            is_codex=is_codex,
        )
        ok = deps.send_keys(
            agent_id,
            replay_message,
            send_enter=True,
            clear_input=is_codex,
            escape_first=is_codex,
            enter_via_key=is_codex,
        )
        if not ok:
            if next_attempt >= _MAX_REPLAY_ATTEMPTS:
                deps.mark_inbound_message_state(
                    repo_root,
                    agent_id=agent_id,
                    message_id=message_id,
                    state='dead_letter',
                    detail='inbound_drain_send_keys_failed',
                    attempt_count=next_attempt,
                    claim_owner=claim_owner,
                )
                summary['dead_lettered'] += 1
            else:
                next_retry_at = (_utc_now() + timedelta(seconds=_RETRY_BACKOFF_SECONDS)).isoformat().replace('+00:00', 'Z')
                deps.mark_inbound_message_state(
                    repo_root,
                    agent_id=agent_id,
                    message_id=message_id,
                    state='dispatch_failed',
                    detail='inbound_drain_send_keys_failed',
                    attempt_count=next_attempt,
                    claim_owner=claim_owner,
                    next_retry_at=next_retry_at,
                )
                summary['failed'] += 1
            summary['rc'] = 1
            continue

        deps.mark_inbound_message_state(
            repo_root,
            agent_id=agent_id,
            message_id=message_id,
            state='dispatched',
            detail='inbound_drain_dispatch_ok',
            attempt_count=next_attempt,
            claim_owner=claim_owner,
        )
        delivery_confirmed, observed_state, observed_reason = _confirm_delivery_after_send(
            deps,
            agent_id=agent_id,
            launcher=launcher,
        )
        if delivery_confirmed:
            deps.mark_inbound_message_state(
                repo_root,
                agent_id=agent_id,
                message_id=message_id,
                state='handled',
                detail=f"inbound_drain_handled:{trigger}:{observed_state}:{observed_reason}",
                attempt_count=next_attempt,
                claim_owner=claim_owner,
            )
            summary['drained'] += 1
            continue

        next_retry_at = (_utc_now() + timedelta(seconds=_RETRY_BACKOFF_SECONDS)).isoformat().replace('+00:00', 'Z')
        deps.mark_inbound_message_state(
            repo_root,
            agent_id=agent_id,
            message_id=message_id,
            state='dispatch_failed',
            detail=f"inbound_drain_delivery_unconfirmed:{observed_state}:{observed_reason}",
            attempt_count=next_attempt,
            claim_owner=claim_owner,
            next_retry_at=next_retry_at,
        )
        summary['failed'] += 1
        summary['rc'] = 1

    return summary


def cmd_inbound(args, *, deps: Any, drain_once_handler: Optional[Callable[..., Dict[str, int]]] = None):
    """Handle inbound queue recovery subcommands."""
    if drain_once_handler is None:
        drain_once_handler = drain_main_inbound_once

    if args.inbound_command != 'drain':
        print(f"Unknown inbound command: {args.inbound_command}")
        return 1

    agent_config = deps.resolve_agent(args.agent)
    if not agent_config:
        print(f"❌ Agent not found: {args.agent}")
        return 1

    agent_id = deps.get_agent_id(agent_config)
    if agent_id != 'main':
        print("❌ inbound drain currently supports only the main agent")
        return 1

    if not getattr(args, 'once', False):
        print("❌ inbound drain currently requires --once")
        return 1

    summary = drain_once_handler(deps=deps, agent_id=agent_id, trigger='cli')
    if summary['rc'] != 0 and summary['drained'] == 0 and summary['dead_lettered'] == 0:
        return summary['rc']

    print(
        "Inbound drain summary: "
        f"drained={summary['drained']} "
        f"failed={summary['failed']} "
        f"dead_lettered={summary['dead_lettered']} "
        f"skipped={summary['skipped']}"
    )
    return summary['rc']
