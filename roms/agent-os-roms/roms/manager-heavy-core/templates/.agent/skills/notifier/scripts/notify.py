#!/usr/bin/env python3
"""
Notification script for sending alerts to multiple channels.

Supports:
- Feishu webhook
- Slack webhook
- Telegram bot (future)
- Email (future)
"""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError


def _find_repo_root(start: Path) -> Path:
    start_dir = start if start.is_dir() else start.parent
    for candidate in [start_dir, *start_dir.parents]:
        if (candidate / '.agent').is_dir():
            return candidate
    return start_dir


def _default_feishu_webhook_file() -> Path:
    repo_root = _find_repo_root(Path(__file__).resolve())
    return repo_root / '.claude' / 'state' / 'notifier' / 'feishu-webhook.txt'


def _default_slack_webhook_file() -> Path:
    repo_root = _find_repo_root(Path(__file__).resolve())
    return repo_root / '.claude' / 'state' / 'notifier' / 'slack-webhook.txt'


def _default_slack_token_file() -> Path:
    repo_root = _find_repo_root(Path(__file__).resolve())
    return repo_root / '.claude' / 'state' / 'notifier' / 'slack-token.txt'


def _default_slack_channel_file() -> Path:
    repo_root = _find_repo_root(Path(__file__).resolve())
    return repo_root / '.claude' / 'state' / 'notifier' / 'slack-channel-id.txt'


def _read_default_feishu_webhook() -> str | None:
    try:
        path = _default_feishu_webhook_file()
        if not path.exists():
            return None
        value = path.read_text(encoding='utf-8').strip()
        return value or None
    except Exception:
        return None


def _read_default_slack_webhook() -> str | None:
    try:
        path = _default_slack_webhook_file()
        if not path.exists():
            return None
        value = path.read_text(encoding='utf-8').strip()
        return value or None
    except Exception:
        return None


def _read_default_slack_token() -> str | None:
    try:
        path = _default_slack_token_file()
        if not path.exists():
            return None
        value = path.read_text(encoding='utf-8').strip()
        return value or None
    except Exception:
        return None


def _read_default_slack_channel_id() -> str | None:
    try:
        path = _default_slack_channel_file()
        if not path.exists():
            return None
        value = path.read_text(encoding='utf-8').strip()
        return value or None
    except Exception:
        return None


def normalize_feishu_markdown(text: str) -> str:
    """Feishu card markdown treats single newlines as spaces.

    Convert plain newlines into markdown hard line breaks (two trailing spaces
    before newline), while preserving code fences.
    """
    if text is None:
        return ""

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")

    out: list[str] = []
    in_code_block = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            out.append(line)
            continue

        if in_code_block or line == "":
            out.append(line)
        else:
            # Markdown hard line break: end the line with two spaces.
            out.append(line + "  ")

    return "\n".join(out)


def decode_message_escapes(text: str) -> str:
    """Decode common escaped sequences from CLI input (e.g. \\n, \\t, \\\\)."""
    if text is None:
        return ""

    out: list[str] = []
    i = 0
    length = len(text)

    while i < length:
        ch = text[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue

        if i + 1 >= length:
            out.append("\\")
            i += 1
            continue

        nxt = text[i + 1]
        if nxt == "n":
            out.append("\n")
            i += 2
        elif nxt == "r":
            out.append("\r")
            i += 2
        elif nxt == "t":
            out.append("\t")
            i += 2
        elif nxt == "\\":
            out.append("\\")
            i += 2
        else:
            out.append("\\")
            i += 1

    return "".join(out)


def send_feishu(webhook_url: str, title: str, content: str) -> bool:
    """
    Send notification to Feishu webhook.

    Args:
        webhook_url: Feishu webhook URL
        title: Message title
        content: Message content (supports markdown)

    Returns:
        True if successful, False otherwise
    """
    content = normalize_feishu_markdown(content)

    message = {
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {
                    "tag": "plain_text",
                    "content": title
                },
                "template": "red"
            },
            "elements": [
                {
                    "tag": "markdown",
                    "content": content
                }
            ]
        }
    }

    try:
        req = Request(webhook_url, data=json.dumps(message).encode('utf-8'), headers={
            'Content-Type': 'application/json'
        }, method='POST')

        with urlopen(req, timeout=10) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                if data.get('StatusCode', 0) == 0:
                    return True
                else:
                    print(f"Feishu error: {data.get('StatusMessage', 'Unknown error')}", file=sys.stderr)
                    return False
        return False
    except URLError as e:
        print(f"Network error: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        return False


def send_slack(bot_token: str, channel_id: str, title: str, content: str, thread_ts: str | None = None) -> bool:
    """
    Send notification to Slack using Bot Token API.

    Args:
        bot_token: Slack Bot Token (xoxb-...)
        channel_id: Slack Channel ID (C00000000)
        title: Message title
        content: Message content (supports markdown)
        thread_ts: Optional parent message timestamp for threaded replies

    Returns:
        True if successful, False otherwise
    """
    api_url = "https://slack.com/api/chat.postMessage"

    # Build message payload
    message = {
        "channel": channel_id,
        "text": title,
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": title,
                    "emoji": True
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": content
                }
            }
        ]
    }

    # Add thread_ts if replying to a thread
    if thread_ts:
        message["thread_ts"] = thread_ts

    try:
        req = Request(api_url, data=json.dumps(message).encode('utf-8'), headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {bot_token}'
        }, method='POST')

        with urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data.get('ok'):
                return True
            else:
                error = data.get('error', 'Unknown error')
                print(f"Slack API error: {error}", file=sys.stderr)
                return False
    except URLError as e:
        print(f"Network error: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        return False


def send_telegram(bot_token: str, chat_id: str, message: str) -> bool:
    """Send notification to Telegram bot (future implementation)."""
    print("Telegram support not implemented yet", file=sys.stderr)
    return False


def send_email(smtp_config: dict, to: str, subject: str, body: str) -> bool:
    """Send email notification (future implementation)."""
    print("Email support not implemented yet", file=sys.stderr)
    return False


def _is_feishu_configured() -> bool:
    """Check if Feishu webhook is configured."""
    return _read_default_feishu_webhook() is not None


def _is_slack_configured() -> bool:
    """Check if Slack Bot Token and Channel ID are configured."""
    return _read_default_slack_token() is not None and _read_default_slack_channel_id() is not None


def _send_to_feishu(title: str, message: str) -> bool:
    """Send to Feishu channel."""
    webhook_url = _read_default_feishu_webhook()
    if not webhook_url:
        print("Feishu: Skipping (not configured)", file=sys.stderr)
        return False
    if send_feishu(webhook_url, title, message):
        print("Feishu: ✓ Sent")
        return True
    else:
        print("Feishu: ✗ Failed", file=sys.stderr)
        return False


def _send_to_slack(title: str, message: str, thread_ts: str | None = None) -> bool:
    """Send to Slack channel."""
    bot_token = _read_default_slack_token()
    channel_id = _read_default_slack_channel_id()
    if not bot_token or not channel_id:
        print("Slack: Skipping (not configured)", file=sys.stderr)
        return False
    if send_slack(bot_token, channel_id, title, message, thread_ts):
        print("Slack: ✓ Sent")
        return True
    else:
        print("Slack: ✗ Failed", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Send notifications to various channels"
    )

    parser.add_argument('--channel', '-c', default='feishu',
                        choices=['feishu', 'slack', 'telegram', 'email', 'all'],
                        help="Notification channel (use 'all' to send to all configured channels)")

    # Feishu arguments
    parser.add_argument('--feishu-webhook', '-w', '--webhook',
                        help="Feishu webhook URL")

    # Slack arguments
    parser.add_argument('--slack-webhook',
                        help="(Deprecated) Slack webhook URL (use --slack-token/--channel-id instead)")
    parser.add_argument('--slack-token',
                        help="Slack Bot Token (xoxb-...)")
    parser.add_argument('--channel-id',
                        help="Slack Channel ID (C00000000)")
    parser.add_argument('--thread-ts',
                        help="Slack thread timestamp for threaded replies")

    # Telegram arguments
    parser.add_argument('--telegram-token', '-t',
                        help="Telegram bot token (or set TELEGRAM_BOT_TOKEN env var)")
    parser.add_argument('--chat-id',
                        help="Telegram chat ID (or set TELEGRAM_CHAT_ID env var)")

    # Email arguments
    parser.add_argument('--to', help="Email recipient")
    parser.add_argument('--smtp-host', help="SMTP server")
    parser.add_argument('--smtp-port', type=int, default=587, help="SMTP port")

    # Common arguments
    parser.add_argument('--title', '-T', default="Notification",
                        help="Message title (default: Notification)")
    parser.add_argument('--message', '-m', required=True,
                        help="Message content (supports markdown)")

    args = parser.parse_args()
    args.message = decode_message_escapes(args.message)

    # Handle --channel all: send to all configured channels
    if args.channel == 'all':
        print(f"Sending to all configured channels...")
        results = []
        if _is_feishu_configured():
            results.append(_send_to_feishu(args.title, args.message))
        if _is_slack_configured():
            # Note: thread_ts is not used for 'all' mode
            results.append(_send_to_slack(args.title, args.message))
        # Telegram and email not implemented yet
        if not results:
            print("Error: No channels configured. Please configure at least one channel.", file=sys.stderr)
            return 1
        # Return 0 if at least one channel succeeded
        return 0 if any(results) else 1

    # Get webhook URL from args or env
    if args.channel == 'feishu':
        webhook_url = args.feishu_webhook or _read_default_feishu_webhook()
        if not webhook_url:
            print(
                "Error: Feishu webhook URL required via --webhook/--feishu-webhook, "
                f"or set default in {_default_feishu_webhook_file()}",
                file=sys.stderr,
            )
            return 1

        if send_feishu(webhook_url, args.title, args.message):
            print("Feishu notification sent")
            return 0
        else:
            print("Failed to send Feishu notification")
            return 1

    elif args.channel == 'slack':
        bot_token = args.slack_token or _read_default_slack_token()
        channel_id = args.channel_id or _read_default_slack_channel_id()

        if not bot_token:
            print(
                "Error: Slack Bot Token required via --slack-token, "
                f"or set default in {_default_slack_token_file()}",
                file=sys.stderr,
            )
            return 1

        if not channel_id:
            print(
                "Error: Slack Channel ID required via --channel-id, "
                f"or set default in {_default_slack_channel_file()}",
                file=sys.stderr,
            )
            return 1

        if send_slack(bot_token, channel_id, args.title, args.message, args.thread_ts):
            print("Slack notification sent")
            return 0
        else:
            print("Failed to send Slack notification")
            return 1

    elif args.channel == 'telegram':
        bot_token = args.telegram_token or os.environ.get('TELEGRAM_BOT_TOKEN')
        chat_id = args.chat_id or os.environ.get('TELEGRAM_CHAT_ID')
        if not bot_token or not chat_id:
            print("Error: Telegram bot token and chat ID required", file=sys.stderr)
            return 1

        if send_telegram(bot_token, chat_id, args.message):
            print(f"✅ Telegram notification sent")
            return 0
        else:
            print(f"❌ Failed to send Telegram notification")
            return 1

    elif args.channel == 'email':
        if not args.to:
            print("Error: Email recipient required via --to", file=sys.stderr)
            return 1

        smtp_config = {
            'host': args.smtp_host or os.environ.get('SMTP_HOST'),
            'port': args.smtp_port
        }
        if send_email(smtp_config, args.to, args.title, args.message):
            print(f"✅ Email notification sent")
            return 0
        else:
            print(f"❌ Failed to send email notification")
            return 1

    return 0


if __name__ == '__main__':
    sys.exit(main())
