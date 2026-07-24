from __future__ import annotations

import subprocess
from typing import Any, Optional


META_SECTION = "--- Meta ---"
BODY_SECTION = "--- Body ---"
FOOTER_SECTION = "--- Footer ---"


def generate_message_id(deps: Any) -> str:
    datetime_mod = getattr(deps, 'datetime')
    uuid_mod = getattr(deps, 'uuid')
    now = datetime_mod.now()
    return f"msg_{now.strftime('%Y%m%d_%H%M%S')}_{uuid_mod.uuid4().hex[:8]}"


def _clean_optional_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _validate_meta_value(field: str, value: str) -> Optional[str]:
    if not str(value or '').strip():
        return f"Meta field '{field}' is required"
    if '\n' in str(value) or '\r' in str(value):
        return f"Meta field '{field}' must be a single line"
    return None


def _validate_reply_endpoint(value: str) -> Optional[str]:
    endpoint = str(value or '').strip()
    if not endpoint:
        return None
    if '\n' in endpoint or '\r' in endpoint:
        return "Meta field 'reply_endpoint' must be a single line"
    if endpoint == 'stdout':
        return None
    if endpoint.startswith('agent:'):
        target = endpoint[len('agent:'):].strip()
        return None if target else "reply_endpoint agent target is required"
    if endpoint.startswith('tmux:'):
        target = endpoint[len('tmux:'):].strip()
        return None if target else "reply_endpoint tmux target is required"
    if endpoint.startswith('tty:'):
        target = endpoint[len('tty:'):].strip()
        if not target:
            return "reply_endpoint tty target is required"
        if not (target == '/dev/tty' or target.startswith('/dev/pts/')):
            return "reply_endpoint tty target must be /dev/tty or /dev/pts/<n>"
        return None
    return "reply_endpoint must be stdout, agent:<id>, tmux:<target>, or tty:/dev/pts/<n>"


def render_envelope(
    *,
    message_id: str,
    message_type: str,
    from_agent: str,
    to_agent: str,
    body: str,
    footer: str = "",
    reply_to: str = "",
    reply_endpoint: str = "",
) -> str:
    fields = {
        'id': message_id,
        'type': message_type,
        'from': from_agent,
        'to': to_agent,
    }
    if reply_to:
        fields['reply_to'] = reply_to
    if reply_endpoint:
        fields['reply_endpoint'] = reply_endpoint

    meta_lines = [f"{key}: {value}" for key, value in fields.items()]
    parts = [
        META_SECTION,
        *meta_lines,
        "",
        BODY_SECTION,
        body,
    ]
    if footer:
        parts.extend(["", FOOTER_SECTION, footer])
    return "\n".join(parts)


def build_envelope(
    *,
    deps: Any,
    message_type: str,
    from_agent: str,
    to_agent: str,
    body: str,
    footer: Optional[str] = None,
    message_id: Optional[str] = None,
    reply_to: Optional[str] = None,
    reply_endpoint: Optional[str] = None,
) -> tuple[Optional[str], Optional[str], str]:
    message_type = str(message_type or '').strip()
    if message_type not in {'message', 'reply'}:
        return None, None, "Message type must be 'message' or 'reply'"

    cleaned = {
        'id': _clean_optional_text(message_id) or generate_message_id(deps),
        'type': message_type,
        'from': _clean_optional_text(from_agent),
        'to': _clean_optional_text(to_agent),
    }
    cleaned_reply_to = _clean_optional_text(reply_to)
    cleaned_reply_endpoint = _clean_optional_text(reply_endpoint)
    if message_type == 'reply' and not cleaned_reply_to:
        return None, None, "Meta field 'reply_to' is required for replies"
    if cleaned_reply_to:
        cleaned['reply_to'] = cleaned_reply_to
    endpoint_error = _validate_reply_endpoint(cleaned_reply_endpoint)
    if endpoint_error:
        return None, None, endpoint_error
    if cleaned_reply_endpoint:
        cleaned['reply_endpoint'] = cleaned_reply_endpoint

    for field, value in cleaned.items():
        error = _validate_meta_value(field, value)
        if error:
            return None, None, error

    if body is None or not str(body).strip():
        return None, None, "Body is required"

    envelope = render_envelope(
        message_id=cleaned['id'],
        message_type=message_type,
        from_agent=cleaned['from'],
        to_agent=cleaned['to'],
        body=str(body),
        footer=_clean_optional_text(footer),
        reply_to=cleaned_reply_to,
        reply_endpoint=cleaned_reply_endpoint,
    )
    return envelope, cleaned['id'], ""


def _agent_meta_name(agent_config: dict, fallback: str) -> str:
    return str(agent_config.get('file_id') or agent_config.get('name') or fallback)


def _resolve_target(args: Any, deps: Any, *, value: str) -> tuple[Optional[dict], str, str]:
    agent_config = deps.resolve_agent(value)
    if not agent_config:
        return None, "", f"Agent not found: {value}"
    return agent_config, _agent_meta_name(agent_config, value), ""


def _is_reply_addressable(args: Any, deps: Any, *, sender: str, reply_endpoint: str) -> bool:
    if str(reply_endpoint or '').strip():
        return True
    return deps.resolve_agent(sender) is not None


def _send_envelope(args: Any, deps: Any, *, target_config: dict, envelope: str) -> int:
    check_tmux = deps.check_tmux
    session_exists = deps.session_exists
    get_agent_id = deps.get_agent_id
    resolve_launcher_command = deps.resolve_launcher_command
    send_keys = deps.send_keys

    agent_name = target_config['name']
    agent_id = get_agent_id(target_config)

    if not check_tmux():
        print("❌ tmux is not installed")
        return 1

    if not session_exists(agent_id):
        print(f"⚠️  Agent '{agent_name}' is not running")
        return 1

    launcher = resolve_launcher_command(target_config.get('launcher', ''))
    is_codex = 'codex' in launcher.lower()
    if not send_keys(
        agent_id,
        envelope,
        send_enter=True,
        clear_input=is_codex,
        escape_first=is_codex,
        enter_via_key=is_codex,
    ):
        print(f"❌ Failed to send protocol message to {agent_name}")
        return 1

    print(f"✅ Protocol message sent to {agent_name}")
    print("   Note: delivery success only means tmux accepted the send operation.")
    return 0


def _send_tmux_target(args: Any, deps: Any, *, target: str, envelope: str) -> int:
    if not deps.check_tmux():
        print("❌ tmux is not installed")
        return 1
    if '\n' in target or '\r' in target or not target.strip():
        print("❌ Invalid tmux endpoint target")
        return 1
    try:
        subprocess.run(
            ['tmux', 'load-buffer', '-b', 'agent-message-endpoint', '-'],
            input=envelope,
            capture_output=True,
            text=True,
            check=True,
        )
        subprocess.run(
            ['tmux', 'paste-buffer', '-d', '-b', 'agent-message-endpoint', '-t', target],
            capture_output=True,
            text=True,
            check=True,
        )
        subprocess.run(
            ['tmux', 'send-keys', '-t', target, 'C-m'],
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception as exc:
        print(f"❌ Failed to send protocol message to tmux endpoint {target}: {exc}")
        return 1
    print(f"✅ Protocol message sent to tmux endpoint {target}")
    print("   Note: delivery success only means tmux accepted the send operation.")
    return 0


def _send_tty_target(*, target: str, envelope: str) -> int:
    error = _validate_reply_endpoint(f"tty:{target}")
    if error:
        print(f"❌ {error}")
        return 1
    try:
        with open(target, 'a', encoding='utf-8') as tty:
            tty.write("\n")
            tty.write(envelope)
            tty.write("\n")
    except Exception as exc:
        print(f"❌ Failed to write protocol message to tty endpoint {target}: {exc}")
        return 1
    print(f"✅ Protocol message written to tty endpoint {target}")
    print("   Note: tty delivery only writes to the terminal display; it is not an interactive turn acknowledgement.")
    return 0


def _send_envelope_to_endpoint(args: Any, deps: Any, *, endpoint: str, envelope: str) -> int:
    endpoint = str(endpoint or '').strip()
    error = _validate_reply_endpoint(endpoint)
    if error:
        print(f"❌ {error}")
        return 1
    if endpoint == 'stdout':
        print(envelope)
        return 0
    if endpoint.startswith('agent:'):
        target_config, _to_agent, error = _resolve_target(args, deps, value=endpoint[len('agent:'):].strip())
        if error:
            print(f"❌ {error}")
            return 1
        return _send_envelope(args, deps, target_config=target_config, envelope=envelope)
    if endpoint.startswith('tmux:'):
        return _send_tmux_target(args, deps, target=endpoint[len('tmux:'):].strip(), envelope=envelope)
    if endpoint.startswith('tty:'):
        return _send_tty_target(target=endpoint[len('tty:'):].strip(), envelope=envelope)
    print("❌ Unsupported reply endpoint")
    return 1


def cmd_message(args: Any, *, deps: Any) -> int:
    command = getattr(args, 'message_command', None)
    if command == 'compose':
        envelope, _message_id, error = build_envelope(
            deps=deps,
            message_type='message',
            from_agent=args.from_agent,
            to_agent=args.to_agent,
            body=args.body,
            footer=getattr(args, 'footer', None),
            message_id=getattr(args, 'id', None),
            reply_endpoint=getattr(args, 'reply_endpoint', None),
        )
        if error:
            print(f"❌ {error}")
            return 1
        print(envelope)
        return 0

    if command == 'send':
        target_config, to_agent, error = _resolve_target(args, deps, value=args.agent)
        if error:
            print(f"❌ {error}")
            return 1
        reply_endpoint = getattr(args, 'reply_endpoint', None)
        if not _is_reply_addressable(args, deps, sender=args.from_agent, reply_endpoint=reply_endpoint):
            print(
                "❌ Sender is not reply-addressable: use a resolvable agent in --from "
                "or pass --reply-endpoint"
            )
            return 1
        envelope, _message_id, error = build_envelope(
            deps=deps,
            message_type='message',
            from_agent=args.from_agent,
            to_agent=to_agent,
            body=args.body,
            footer=getattr(args, 'footer', None),
            message_id=getattr(args, 'id', None),
            reply_endpoint=reply_endpoint,
        )
        if error:
            print(f"❌ {error}")
            return 1
        return _send_envelope(args, deps, target_config=target_config, envelope=envelope)

    if command == 'reply':
        endpoint = getattr(args, 'to_endpoint', None)
        target_config = None
        if endpoint:
            to_agent = endpoint
        else:
            target_config, to_agent, error = _resolve_target(args, deps, value=args.to_agent)
            if error:
                print(f"❌ {error}")
                return 1
        envelope, _message_id, error = build_envelope(
            deps=deps,
            message_type='reply',
            from_agent=args.from_agent,
            to_agent=to_agent,
            body=args.body,
            footer=getattr(args, 'footer', None),
            message_id=getattr(args, 'id', None),
            reply_to=args.reply_to,
            reply_endpoint=getattr(args, 'reply_endpoint', None),
        )
        if error:
            print(f"❌ {error}")
            return 1
        if endpoint:
            return _send_envelope_to_endpoint(args, deps, endpoint=endpoint, envelope=envelope)
        return _send_envelope(args, deps, target_config=target_config, envelope=envelope)

    print("❌ Missing message subcommand")
    return 1
