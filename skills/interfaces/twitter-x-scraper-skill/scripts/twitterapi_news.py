#!/usr/bin/env python3
"""twitterapi.io helper for fast-moving news discovery and verification."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
import textwrap
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

DEFAULT_BASE_URL = "https://api.twitterapi.io"
DEFAULT_QUERY_TYPE = "Latest"
DEFAULT_LIMIT = 10
DEFAULT_TIMEOUT = 30


class TwitterApiNewsError(RuntimeError):
    pass


@dataclass
class ClientConfig:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    timeout: int = DEFAULT_TIMEOUT


def _default_env_file() -> Path:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser()
    return codex_home / "state" / "private" / "twitterapi-io.env"


def _load_env_file(env_file: Path) -> Dict[str, str]:
    env: Dict[str, str] = {}
    if not env_file.exists():
        return env
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        try:
            env[key] = shlex.split(value)[0] if value else ""
        except ValueError:
            env[key] = value.strip('"\'')
    return env


def _merge_env(env_file: Path) -> Dict[str, str]:
    merged = dict(_load_env_file(env_file))
    merged.update({k: v for k, v in os.environ.items() if k.startswith("TWITTERAPI_IO_")})
    return merged


def _require_config(args: argparse.Namespace) -> Tuple[ClientConfig, Dict[str, str]]:
    env_file = Path(args.env_file).expanduser() if args.env_file else _default_env_file()
    env = _merge_env(env_file)
    api_key = args.api_key or env.get("TWITTERAPI_IO_KEY")
    if not api_key:
        raise TwitterApiNewsError(
            f"Missing TWITTERAPI_IO_KEY. Set it in environment or in {env_file}."
        )
    base_url = args.base_url or env.get("TWITTERAPI_IO_BASE_URL") or DEFAULT_BASE_URL
    return ClientConfig(api_key=api_key, base_url=base_url.rstrip("/"), timeout=args.timeout), env


def _api_get(config: ClientConfig, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = {
        key: ("true" if value is True else "false" if value is False else str(value))
        for key, value in params.items()
        if value is not None and value != ""
    }
    url = f"{config.base_url}{path}"
    if cleaned:
        url = f"{url}?{urllib.parse.urlencode(cleaned)}"

    request = urllib.request.Request(
        url,
        headers={
            "X-API-Key": config.api_key,
            "Accept": "application/json",
            "User-Agent": "twitter-x-scraper",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise TwitterApiNewsError(f"HTTP {exc.code} for {path}: {body}") from exc
    except urllib.error.URLError as exc:
        raise TwitterApiNewsError(f"Request failed for {path}: {exc}") from exc

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise TwitterApiNewsError(f"Invalid JSON from {path}: {body[:400]}") from exc


def _to_iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _epoch_seconds(dt: datetime) -> int:
    return int(dt.timestamp())


def _append_time_window(query: str, hours: Optional[int]) -> str:
    if not hours:
        return query
    lowered = query.lower()
    if "since_time:" in lowered or "until_time:" in lowered:
        return query
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    return f"{query} since_time:{_epoch_seconds(start)} until_time:{_epoch_seconds(now)}"


def _append_news_filters(query: str) -> str:
    lowered = query.lower()
    additions = []
    if 'is:reply' not in lowered:
        additions.append('-is:reply')
    if 'is:retweet' not in lowered:
        additions.append('-is:retweet')
    if additions:
        return f"{query} {' '.join(additions)}"
    return query


def _nested(payload: Dict[str, Any], *keys: str) -> Any:
    current: Any = payload
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def _first_present(payload: Dict[str, Any], *paths: Tuple[str, ...]) -> Any:
    for path in paths:
        value = _nested(payload, *path)
        if value is not None:
            return value
    return None


def _tweet_author(tweet: Dict[str, Any]) -> Dict[str, Any]:
    return tweet.get("author") or {}


def _tweet_summary(tweet: Dict[str, Any]) -> Dict[str, Any]:
    author = _tweet_author(tweet)
    return {
        "id": tweet.get("id"),
        "createdAt": tweet.get("createdAt"),
        "url": tweet.get("url"),
        "text": tweet.get("text", "").replace("\n", " ").strip(),
        "authorName": author.get("name") or author.get("userName"),
        "authorUserName": author.get("userName"),
        "authorId": author.get("id"),
        "followers": author.get("followers"),
        "likeCount": tweet.get("likeCount"),
        "retweetCount": tweet.get("retweetCount"),
        "replyCount": tweet.get("replyCount"),
        "quoteCount": tweet.get("quoteCount"),
        "viewCount": tweet.get("viewCount"),
        "lang": tweet.get("lang"),
        "isReply": tweet.get("isReply"),
        "isRetweet": bool(tweet.get("retweeted_tweet")),
        "isQuote": bool(tweet.get("quoted_tweet")),
    }


def _format_count(value: Any) -> str:
    if value is None:
        return "-"
    try:
        num = int(value)
    except (TypeError, ValueError):
        return str(value)
    if num >= 1_000_000:
        return f"{num / 1_000_000:.1f}M"
    if num >= 1_000:
        return f"{num / 1_000:.1f}K"
    return str(num)


def _print_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _print_tweets_brief(title: str, tweets: Iterable[Dict[str, Any]], meta: Optional[Dict[str, Any]] = None) -> None:
    print(title)
    print("=" * len(title))
    for idx, tweet in enumerate(tweets, start=1):
        summary = _tweet_summary(tweet)
        who = summary["authorName"] or "unknown"
        handle = f"@{summary['authorUserName']}" if summary["authorUserName"] else ""
        metrics = (
            f"likes { _format_count(summary['likeCount']) } | "
            f"rts { _format_count(summary['retweetCount']) } | "
            f"replies { _format_count(summary['replyCount']) } | "
            f"views { _format_count(summary['viewCount']) }"
        )
        print(f"{idx}. {who} {handle}".rstrip())
        print(f"   时间: {summary['createdAt'] or '-'}")
        print(f"   指标: {metrics}")
        print(f"   链接: {summary['url'] or '-'}")
        print(f"   内容: {summary['text'] or '-'}")
    if meta:
        print("\nMETA")
        for key, value in meta.items():
            print(f"- {key}: {value}")


def _print_users_brief(title: str, users: Iterable[Dict[str, Any]]) -> None:
    print(title)
    print("=" * len(title))
    for idx, user in enumerate(users, start=1):
        print(f"{idx}. {user.get('name') or '-'} @{user.get('userName') or '-'}")
        print(f"   ID: {user.get('id') or '-'}")
        print(f"   Followers: {_format_count(user.get('followers'))} | Following: {_format_count(user.get('following'))}")
        print(f"   Created: {user.get('createdAt') or '-'}")
        print(f"   URL: {user.get('url') or '-'}")
        print(f"   Bio: {(user.get('description') or '').replace(chr(10), ' ').strip() or '-'}")


def cmd_search(args: argparse.Namespace) -> int:
    config, _env = _require_config(args)
    query = _append_time_window(args.query, args.hours)
    payload = _api_get(
        config,
        "/twitter/tweet/advanced_search",
        {
            "query": query,
            "queryType": args.query_type,
            "cursor": args.cursor,
        },
    )
    tweets = (_first_present(payload, ('tweets',), ('data', 'tweets')) or [])[: args.limit]
    if args.json:
        _print_json(
            {
                "query": query,
                "queryType": args.query_type,
                "tweetCount": len(tweets),
                "has_next_page": _first_present(payload, ('has_next_page',), ('data', 'has_next_page')),
                "next_cursor": _first_present(payload, ('next_cursor',), ('data', 'next_cursor')),
                "tweets": [_tweet_summary(tweet) for tweet in tweets],
            }
        )
    else:
        _print_tweets_brief(
            f"Twitter/X 搜索结果: {query}",
            tweets,
            meta={
                "queryType": args.query_type,
                "tweetCount": len(tweets),
                "has_next_page": _first_present(payload, ('has_next_page',), ('data', 'has_next_page')),
                "next_cursor": _first_present(payload, ('next_cursor',), ('data', 'next_cursor')) or "",
            },
        )
    return 0


def cmd_user_lookup(args: argparse.Namespace) -> int:
    config, env = _require_config(args)
    user_ids: List[str] = []
    if args.user_ids:
        user_ids.extend([item.strip() for item in args.user_ids.split(",") if item.strip()])
    elif env.get("TWITTERAPI_IO_USER_ID"):
        user_ids.append(env["TWITTERAPI_IO_USER_ID"])
    if not user_ids:
        raise TwitterApiNewsError("Provide --user-ids or set TWITTERAPI_IO_USER_ID.")

    payload = _api_get(
        config,
        "/twitter/user/batch_info_by_ids",
        {"userIds": ",".join(user_ids)},
    )
    users = _first_present(payload, ('users',), ('data', 'users')) or []
    if args.json:
        _print_json({"users": users, "status": payload.get("status"), "msg": payload.get("msg")})
    else:
        _print_users_brief("Twitter/X 用户信息", users)
    return 0


def cmd_timeline(args: argparse.Namespace) -> int:
    config, env = _require_config(args)
    user_name = args.user_name
    user_id = args.user_id
    if not user_id and not user_name:
        user_id = env.get("TWITTERAPI_IO_USER_ID")
    if not user_id and not user_name:
        raise TwitterApiNewsError("Provide --user-id/--user-name or set TWITTERAPI_IO_USER_ID.")

    payload = _api_get(
        config,
        "/twitter/user/last_tweets",
        {
            "userId": user_id,
            "userName": user_name,
            "cursor": args.cursor,
            "includeReplies": args.include_replies,
        },
    )
    tweets = (_first_present(payload, ('tweets',), ('data', 'tweets')) or [])[: args.limit]
    if args.json:
        _print_json(
            {
                "userId": user_id,
                "userName": user_name,
                "tweetCount": len(tweets),
                "has_next_page": _first_present(payload, ('has_next_page',), ('data', 'has_next_page')),
                "next_cursor": _first_present(payload, ('next_cursor',), ('data', 'next_cursor')),
                "status": payload.get("status"),
                "message": payload.get("message") or payload.get("msg"),
                "tweets": [_tweet_summary(tweet) for tweet in tweets],
            }
        )
    else:
        title_target = user_name or user_id or "user"
        _print_tweets_brief(
            f"Twitter/X 时间线: {title_target}",
            tweets,
            meta={
                "includeReplies": args.include_replies,
                "tweetCount": len(tweets),
                "has_next_page": _first_present(payload, ('has_next_page',), ('data', 'has_next_page')),
                "next_cursor": _first_present(payload, ('next_cursor',), ('data', 'next_cursor')) or "",
                "status": payload.get("status") or "",
            },
        )
    return 0


def cmd_news_brief(args: argparse.Namespace) -> int:
    config, _env = _require_config(args)
    queries = [item.strip() for item in args.query if item.strip()]
    if not queries:
        raise TwitterApiNewsError("At least one --query is required.")

    sections: List[Dict[str, Any]] = []
    for query in queries:
        expanded_query = _append_time_window(query, args.hours)
        if not args.include_replies_retweets:
            expanded_query = _append_news_filters(expanded_query)
        payload = _api_get(
            config,
            "/twitter/tweet/advanced_search",
            {
                "query": expanded_query,
                "queryType": args.query_type,
                "cursor": "",
            },
        )
        tweets = (_first_present(payload, ('tweets',), ('data', 'tweets')) or [])[: args.limit]
        sections.append(
            {
                "query": expanded_query,
                "tweetCount": len(tweets),
                "tweets": [_tweet_summary(tweet) for tweet in tweets],
            }
        )

    if args.json:
        _print_json({"generatedAt": _to_iso_utc(datetime.now(timezone.utc)), "sections": sections})
    else:
        print(f"Twitter/X 新闻线索 ({_to_iso_utc(datetime.now(timezone.utc))})")
        print("=" * 48)
        for section in sections:
            print(f"\n## 查询: {section['query']}")
            for idx, tweet in enumerate(section["tweets"], start=1):
                who = tweet["authorName"] or tweet["authorUserName"] or "unknown"
                handle = f"@{tweet['authorUserName']}" if tweet["authorUserName"] else ""
                print(f"- {idx}. {who} {handle}".rstrip())
                print(f"  时间: {tweet['createdAt'] or '-'}")
                print(f"  链接: {tweet['url'] or '-'}")
                print(
                    "  指标: "
                    f"likes {_format_count(tweet['likeCount'])}, "
                    f"rts {_format_count(tweet['retweetCount'])}, "
                    f"replies {_format_count(tweet['replyCount'])}, "
                    f"views {_format_count(tweet['viewCount'])}"
                )
                print(f"  摘要: {tweet['text'] or '-'}")
            if not section["tweets"]:
                print("- 无结果")
        print("\n提示: Twitter/X 只作为快速线索源；对外发送前应用官方/主流媒体二次核对。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch Twitter/X news signals through twitterapi.io for heartbeat news briefs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent(
            """
            Examples:
              python3 scripts/twitterapi_news.py user-lookup --json
              python3 scripts/twitterapi_news.py timeline --user-id 373934239856070656 --limit 5
              python3 scripts/twitterapi_news.py search --query 'OpenAI OR Anthropic' --hours 24 --limit 5
              python3 scripts/twitterapi_news.py news-brief --query 'TSMC AI' --query 'OpenAI OR Anthropic' --hours 24
            """
        ),
    )
    parser.add_argument("--env-file", help="Path to a local env file. Defaults to $CODEX_HOME/state/private/twitterapi-io.env")
    parser.add_argument("--api-key", help="twitterapi.io API key. Prefer env file or TWITTERAPI_IO_KEY.")
    parser.add_argument("--base-url", default=None, help=f"API base URL. Default: {DEFAULT_BASE_URL}")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"HTTP timeout in seconds. Default: {DEFAULT_TIMEOUT}")

    subparsers = parser.add_subparsers(dest="command", required=True)

    search = subparsers.add_parser("search", help="Run advanced tweet search")
    search.add_argument("--query", required=True, help="Twitter advanced-search query")
    search.add_argument("--hours", type=int, help="Auto-append since_time/until_time for the past N hours")
    search.add_argument("--query-type", choices=["Latest", "Top"], default=DEFAULT_QUERY_TYPE)
    search.add_argument("--cursor", default="")
    search.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    search.add_argument("--json", action="store_true", help="Print normalized JSON")
    search.set_defaults(func=cmd_search)

    user_lookup = subparsers.add_parser("user-lookup", help="Fetch user info by user ids")
    user_lookup.add_argument("--user-ids", help="Comma-separated user ids. Defaults to TWITTERAPI_IO_USER_ID")
    user_lookup.add_argument("--json", action="store_true", help="Print raw-ish JSON")
    user_lookup.set_defaults(func=cmd_user_lookup)

    timeline = subparsers.add_parser("timeline", help="Fetch a user's latest tweets")
    timeline.add_argument("--user-id", help="Twitter user id. Defaults to TWITTERAPI_IO_USER_ID")
    timeline.add_argument("--user-name", help="Twitter/X handle without @")
    timeline.add_argument("--include-replies", action="store_true")
    timeline.add_argument("--cursor", default="")
    timeline.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    timeline.add_argument("--json", action="store_true", help="Print normalized JSON")
    timeline.set_defaults(func=cmd_timeline)

    news_brief = subparsers.add_parser("news-brief", help="Run multiple searches and print brief-ready clues")
    news_brief.add_argument("--query", action="append", required=True, help="Repeat for each topic")
    news_brief.add_argument("--hours", type=int, default=24, help="Past N hours window. Default: 24")
    news_brief.add_argument("--query-type", choices=["Latest", "Top"], default=DEFAULT_QUERY_TYPE)
    news_brief.add_argument("--limit", type=int, default=5)
    news_brief.add_argument("--include-replies-retweets", action="store_true", help="Keep replies/retweets in news-brief mode")
    news_brief.add_argument("--json", action="store_true", help="Print normalized JSON")
    news_brief.set_defaults(func=cmd_news_brief)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except TwitterApiNewsError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())

