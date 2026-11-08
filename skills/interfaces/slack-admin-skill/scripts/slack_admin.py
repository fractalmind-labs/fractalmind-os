#!/usr/bin/env python3
"""Slack workspace administration CLI.

Single-file tool using only Python stdlib. Manages users, channels, files,
and bot settings via the Slack Web API.

Token resolution order:
  1. --token CLI argument
  2. SLACK_BOT_TOKEN environment variable
  3. ~/.config/fractalbot/config.yaml → channels.slack.botToken
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


# ---------------------------------------------------------------------------
# Token resolution
# ---------------------------------------------------------------------------

def _read_fractalbot_token() -> str | None:
    """Read botToken from fractalbot config.yaml (simple YAML parse, no deps)."""
    cfg = Path.home() / ".config" / "fractalbot" / "config.yaml"
    if not cfg.exists():
        return None
    try:
        text = cfg.read_text()
        # Walk lines looking for botToken under channels.slack
        in_channels = False
        in_slack = False
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("channels:"):
                in_channels = True
                continue
            if in_channels and stripped.startswith("slack:"):
                in_slack = True
                continue
            if in_slack and stripped.startswith("botToken:"):
                return stripped.split(":", 1)[1].strip()
            # Reset if we leave the indented block
            if in_channels and not line.startswith(" ") and not line.startswith("\t") and stripped:
                in_channels = False
                in_slack = False
    except Exception:
        return None
    return None


def resolve_token(args) -> str:
    """Resolve token from CLI arg, env var, or fractalbot config."""
    token = getattr(args, "token", None)
    if token:
        return token
    token = os.environ.get("SLACK_BOT_TOKEN")
    if token:
        return token
    token = _read_fractalbot_token()
    if token:
        return token
    print("Error: No Slack token found.", file=sys.stderr)
    print("Provide --token, set SLACK_BOT_TOKEN, or configure fractalbot.", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Slack API helper
# ---------------------------------------------------------------------------

# Response headers of the most recent successful call. Slack returns the
# token's granted scopes in the `x-oauth-scopes` header, which is the only
# reliable way to tell which scopes a bot token actually has.
_LAST_HEADERS: dict = {}


def slack_api(method: str, token: str, params: dict = None, json_body: dict = None,
              multipart: dict = None) -> dict:
    """Call a Slack Web API method.

    Args:
        method: API method name (e.g. 'auth.test')
        token: Bot token
        params: Query parameters (for GET-style calls sent as form body)
        json_body: JSON request body
        multipart: Dict of {field: (filename, data, content_type)} for file uploads
    """
    url = f"https://slack.com/api/{method}"
    headers = {"Authorization": f"Bearer {token}"}

    if multipart:
        boundary = "----SlackAdminBoundary9876543210"
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        body_parts = []
        for field, value in multipart.items():
            if isinstance(value, tuple):
                filename, data, content_type = value
                body_parts.append(
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
                    f"Content-Type: {content_type}\r\n\r\n"
                )
                body_parts.append(data)
                body_parts.append("\r\n")
            else:
                body_parts.append(
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="{field}"\r\n\r\n'
                    f"{value}\r\n"
                )
        body_parts.append(f"--{boundary}--\r\n")
        # Combine parts into bytes
        body = b""
        for part in body_parts:
            if isinstance(part, bytes):
                body += part
            else:
                body += part.encode("utf-8")
    elif json_body is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        body = json.dumps(json_body).encode("utf-8")
    elif params:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = urllib.parse.urlencode(params).encode("utf-8")
    else:
        body = b""

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            _LAST_HEADERS.clear()
            _LAST_HEADERS.update(
                {key.lower(): value for key, value in resp.headers.items()}
            )
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {error_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Network error: {e.reason}", file=sys.stderr)
        sys.exit(1)


def _check_ok(result: dict):
    """Check Slack API response and exit on error."""
    if not result.get("ok"):
        error = result.get("error", "unknown_error")
        needed = result.get("needed", "")
        msg = f"Slack API error: {error}"
        if needed:
            msg += f" (needed scope: {needed})"
        print(msg, file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def cmd_auth_test(args):
    token = resolve_token(args)
    result = slack_api("auth.test", token)
    _check_ok(result)
    out = {
        "ok": True,
        "bot": result.get("user"),
        "team": result.get("team"),
        "user_id": result.get("user_id"),
        "team_id": result.get("team_id"),
        "url": result.get("url"),
    }
    print(json.dumps(out, indent=2))


def cmd_user_info(args):
    token = resolve_token(args)
    result = slack_api("users.info", token, params={"user": args.user_id})
    _check_ok(result)
    user = result["user"]
    profile = user.get("profile", {})
    out = {
        "id": user["id"],
        "name": user.get("name"),
        "real_name": user.get("real_name"),
        "display_name": profile.get("display_name"),
        "email": profile.get("email"),
        "title": profile.get("title"),
        "status_text": profile.get("status_text"),
        "status_emoji": profile.get("status_emoji"),
        "timezone": user.get("tz"),
        "is_admin": user.get("is_admin"),
        "is_bot": user.get("is_bot"),
        "avatar_24": profile.get("image_24"),
        "avatar_48": profile.get("image_48"),
        "avatar_72": profile.get("image_72"),
        "avatar_192": profile.get("image_192"),
        "avatar_512": profile.get("image_512"),
        "avatar_original": profile.get("image_original"),
    }
    print(json.dumps(out, indent=2))


def cmd_user_list(args):
    token = resolve_token(args)
    all_members = []
    cursor = ""
    while True:
        params = {"limit": "200"}
        if cursor:
            params["cursor"] = cursor
        result = slack_api("users.list", token, params=params)
        _check_ok(result)
        for user in result.get("members", []):
            profile = user.get("profile", {})
            all_members.append({
                "id": user["id"],
                "name": user.get("name"),
                "real_name": user.get("real_name"),
                "display_name": profile.get("display_name"),
                "email": profile.get("email"),
                "is_admin": user.get("is_admin"),
                "is_bot": user.get("is_bot"),
                "deleted": user.get("deleted"),
            })
        cursor = result.get("response_metadata", {}).get("next_cursor", "")
        if not cursor:
            break
    print(json.dumps(all_members, indent=2))


def cmd_user_avatar(args):
    token = resolve_token(args)
    result = slack_api("users.info", token, params={"user": args.user_id})
    _check_ok(result)
    profile = result["user"].get("profile", {})
    # Prefer original, fall back to largest available
    avatar_url = (profile.get("image_original")
                  or profile.get("image_512")
                  or profile.get("image_192")
                  or profile.get("image_72"))
    if not avatar_url:
        print("Error: No avatar URL found for this user.", file=sys.stderr)
        sys.exit(1)

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        ext = avatar_url.rsplit(".", 1)[-1].split("?")[0] if "." in avatar_url else "jpg"
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        output_path = f"/tmp/slack-avatar-{args.user_id}.{ext}"

    # Download
    req = urllib.request.Request(avatar_url)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        with open(output_path, "wb") as f:
            f.write(data)
        print(json.dumps({"ok": True, "path": output_path, "url": avatar_url, "size": len(data)}, indent=2))
    except Exception as e:
        print(f"Error downloading avatar: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_channel_list(args):
    token = resolve_token(args)
    all_channels = []
    cursor = ""
    while True:
        params = {"types": "public_channel,private_channel", "limit": "200"}
        if cursor:
            params["cursor"] = cursor
        result = slack_api("conversations.list", token, params=params)
        _check_ok(result)
        for ch in result.get("channels", []):
            all_channels.append({
                "id": ch["id"],
                "name": ch.get("name"),
                "is_private": ch.get("is_private"),
                "is_archived": ch.get("is_archived"),
                "num_members": ch.get("num_members"),
                "topic": ch.get("topic", {}).get("value"),
                "purpose": ch.get("purpose", {}).get("value"),
            })
        cursor = result.get("response_metadata", {}).get("next_cursor", "")
        if not cursor:
            break
    print(json.dumps(all_channels, indent=2))


def cmd_channel_info(args):
    token = resolve_token(args)
    result = slack_api("conversations.info", token, params={"channel": args.channel_id})
    _check_ok(result)
    ch = result["channel"]
    out = {
        "id": ch["id"],
        "name": ch.get("name"),
        "is_private": ch.get("is_private"),
        "is_archived": ch.get("is_archived"),
        "created": ch.get("created"),
        "creator": ch.get("creator"),
        "num_members": ch.get("num_members"),
        "topic": ch.get("topic", {}).get("value"),
        "purpose": ch.get("purpose", {}).get("value"),
    }
    print(json.dumps(out, indent=2))


def cmd_channel_create(args):
    token = resolve_token(args)
    body = {"name": args.name}
    if args.private:
        body["is_private"] = True
    result = slack_api("conversations.create", token, json_body=body)
    _check_ok(result)
    ch = result["channel"]
    out = {
        "ok": True,
        "id": ch["id"],
        "name": ch.get("name"),
        "is_private": ch.get("is_private"),
    }
    print(json.dumps(out, indent=2))


def cmd_channel_topic(args):
    token = resolve_token(args)
    result = slack_api("conversations.setTopic", token, json_body={
        "channel": args.channel_id,
        "topic": args.topic,
    })
    _check_ok(result)
    print(json.dumps({"ok": True, "channel": args.channel_id, "topic": args.topic}, indent=2))


def cmd_channel_members(args):
    token = resolve_token(args)
    all_members = []
    cursor = ""
    while True:
        params = {"channel": args.channel_id, "limit": "200"}
        if cursor:
            params["cursor"] = cursor
        result = slack_api("conversations.members", token, params=params)
        _check_ok(result)
        all_members.extend(result.get("members", []))
        cursor = result.get("response_metadata", {}).get("next_cursor", "")
        if not cursor:
            break
    print(json.dumps(all_members, indent=2))


def cmd_upload(args):
    token = resolve_token(args)
    file_path = Path(args.file)
    if not file_path.exists():
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    file_data = file_path.read_bytes()
    file_size = len(file_data)
    filename = file_path.name

    # Step 1: Get upload URL
    result = slack_api("files.getUploadURLExternal", token, params={
        "filename": filename,
        "length": str(file_size),
    })
    _check_ok(result)
    upload_url = result["upload_url"]
    file_id = result["file_id"]

    # Step 2: Upload file content to the URL
    req = urllib.request.Request(upload_url, data=file_data, method="POST")
    req.add_header("Content-Type", "application/octet-stream")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
    except Exception as e:
        print(f"Error uploading file: {e}", file=sys.stderr)
        sys.exit(1)

    # Step 3: Complete the upload
    complete_body = {
        "files": [{"id": file_id, "title": filename}],
        "channel_id": args.channel_id,
    }
    if args.comment:
        complete_body["initial_comment"] = args.comment

    result = slack_api("files.completeUploadExternal", token, json_body=complete_body)
    _check_ok(result)
    print(json.dumps({"ok": True, "file_id": file_id, "filename": filename, "channel": args.channel_id}, indent=2))


def cmd_set_avatar(args):
    token = resolve_token(args)
    image_path = Path(args.image)
    if not image_path.exists():
        print(f"Error: File not found: {image_path}", file=sys.stderr)
        sys.exit(1)

    image_data = image_path.read_bytes()
    # Detect content type from extension
    ext = image_path.suffix.lower()
    content_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif"}
    content_type = content_types.get(ext, "image/png")

    result = slack_api("users.setPhoto", token, multipart={
        "image": (image_path.name, image_data, content_type),
    })
    _check_ok(result)
    print(json.dumps({"ok": True, "message": "Bot avatar updated"}, indent=2))


# Scopes this skill's commands need. `chat:write` is listed because agents
# usually share the token with FractalBot, which needs it to send messages.
REQUIRED_SCOPES = (
    "chat:write",
    "channels:read",
    "groups:read",
    "files:read",
    "users:read",
)

# Scopes FractalBot's inbound path needs to enrich a message that mentions the
# bot: resolving the channel, its recent messages, attached files, and the user
# directory. An agent that gets `missing_scope` while reading a channel is
# almost always missing one of these.
INBOUND_CONTEXT_SCOPES = (
    "channels:read",
    "groups:read",
    "channels:history",
    "groups:history",
    "files:read",
    "users:read",
)

OPTIONAL_SCOPES = (
    "users:read.email",
    "im:read",
    "files:write",
    "channels:manage",
    "groups:write",
    "users.profile:read",
    "team:read",
)


def cmd_scopes(args):
    token = resolve_token(args)
    result = slack_api("auth.test", token)
    _check_ok(result)

    granted_raw = _LAST_HEADERS.get("x-oauth-scopes", "")
    granted = sorted(scope.strip() for scope in granted_raw.split(",") if scope.strip())
    missing_required = [scope for scope in REQUIRED_SCOPES if scope not in granted]
    missing_optional = [scope for scope in OPTIONAL_SCOPES if scope not in granted]
    missing_inbound = [scope for scope in INBOUND_CONTEXT_SCOPES if scope not in granted]

    out = {
        "ok": True,
        "bot": result.get("user"),
        "team": result.get("team"),
        "token_type": result.get("token_type"),
        "granted": granted,
        "missing_required": missing_required,
        "missing_optional": missing_optional,
        "missing_inbound_context": missing_inbound,
        "reinstall_hint": (
            "Add the missing scopes under OAuth & Permissions, then reinstall the "
            "app to the workspace. A Slack bot needs no re-invite for scope "
            "changes, but the token in fractalbot config.yaml must be the new "
            "one if Slack rotates it."
        )
        if missing_required
        else "All required scopes are present.",
    }
    print(json.dumps(out, indent=2))
    if missing_required or missing_inbound:
        sys.exit(1)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Slack workspace administration CLI")
    parser.add_argument("--token", help="Slack bot token (overrides env/config)")

    sub = parser.add_subparsers(dest="command", required=True)

    # auth-test
    sub.add_parser("auth-test", help="Test token and show bot identity")

    # scopes
    sub.add_parser("scopes", help="Show granted token scopes and missing ones")

    # user-info
    p = sub.add_parser("user-info", help="Get user information")
    p.add_argument("user_id", help="Slack user ID (e.g. U0123456789)")

    # user-list
    sub.add_parser("user-list", help="List all workspace users")

    # user-avatar
    p = sub.add_parser("user-avatar", help="Download user avatar")
    p.add_argument("user_id", help="Slack user ID")
    p.add_argument("-o", "--output", help="Output file path (default: /tmp/slack-avatar-<USER_ID>.<ext>)")

    # channel-list
    sub.add_parser("channel-list", help="List all channels")

    # channel-info
    p = sub.add_parser("channel-info", help="Get channel details")
    p.add_argument("channel_id", help="Channel ID")

    # channel-create
    p = sub.add_parser("channel-create", help="Create a new channel")
    p.add_argument("name", help="Channel name")
    p.add_argument("--private", action="store_true", help="Create as private channel")

    # channel-topic
    p = sub.add_parser("channel-topic", help="Set channel topic")
    p.add_argument("channel_id", help="Channel ID")
    p.add_argument("topic", help="New topic text")

    # channel-members
    p = sub.add_parser("channel-members", help="List channel members")
    p.add_argument("channel_id", help="Channel ID")

    # upload
    p = sub.add_parser("upload", help="Upload file to channel")
    p.add_argument("file", help="Path to file")
    p.add_argument("channel_id", help="Target channel ID")
    p.add_argument("--comment", help="Initial comment with the file")

    # set-avatar
    p = sub.add_parser("set-avatar", help="Set bot avatar/profile photo")
    p.add_argument("image", help="Path to image file (jpg/png)")

    args = parser.parse_args()

    commands = {
        "auth-test": cmd_auth_test,
        "scopes": cmd_scopes,
        "user-info": cmd_user_info,
        "user-list": cmd_user_list,
        "user-avatar": cmd_user_avatar,
        "channel-list": cmd_channel_list,
        "channel-info": cmd_channel_info,
        "channel-create": cmd_channel_create,
        "channel-topic": cmd_channel_topic,
        "channel-members": cmd_channel_members,
        "upload": cmd_upload,
        "set-avatar": cmd_set_avatar,
    }

    commands[args.command](args)


if __name__ == "__main__":
    main()
