#!/usr/bin/env python3
"""Fetch public Twitter/X posts by directly scraping X guest pages.

Primary method for the twitter-x-scraper skill. Only parsed-field normalization is
local; no tokens, no login, no third-party API required.

Security: the X guest page carries compact JSON with unquoted keys. We extract
fields with narrow regexes and serialize everything as JSON with newlines
escaped, so nothing here ever gets eval'd.

Usage:
  python3 x_public_fetch.py --url https://x.com/somehandle/status/1234567890123456789
  python3 x_public_fetch.py --url <url> --format brief
  python3 x_public_fetch.py --handle somehandle --limit 20
  python3 x_public_fetch.py --handle somehandle --limit 20 --format brief
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DEFAULT_TIMEOUT = 30
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)

_TWEET_ID_RE = re.compile(r"(?:status|posts)/(\d{15,20})")
_FULL_TEXT_RE = re.compile(r'full_text:"((?:[^"\\]|\\.)*)"')
_CREATED_MS_RE = re.compile(r"created_at_ms:(\d{12,14})")
_EDITED_MS_RE = re.compile(r"edit_control_initial:.*?edited_tweet_ids:.*?initial_tweet_id:(\d+)", re.DOTALL)
_SCREEN_NAME_RE = re.compile(r'screen_name:"([^"]+)"')
_NAME_RE = re.compile(r'name:"([^"]+)"')
_FAV_RE = re.compile(r"favorite_count:(\d+)")
_RT_RE = re.compile(r"retweet_count:(\d+)")
_REPLIES_RE = re.compile(r"reply_count:(\d+)")
_BOOKMARKS_RE = re.compile(r"bookmark_count:(\d+)")
_QUOTES_RE = re.compile(r"quote_count:(\d+)")
_EXPANDED_URL_RE = re.compile(r'expanded_url:"([^"]+)"')
_TEXT_RANGE_RE = re.compile(r"display_text_range:\[(\d+),(\d+)\]")
_FULL_NAME_RE = re.compile(r'name:"([^"]+)"')

# Compact JSON from X may interleave tokens before a count value; keep only digits.
_TRASH_BEFORE_COUNT = re.compile(r"[^\d]*?")


def _count_value(raw: str) -> Optional[int]:
    """Parse the first integer out of a count snippet (tolerates token noise)."""
    if not raw:
        return None
    match = re.search(r"\d+(?:[,\s]\d+)?", raw)
    if not match:
        return None
    try:
        return int(match.group(0).replace(",", ""))
    except ValueError:
        return None
    m = _TRASH_BEFORE_COUNT.search(raw)
    if not m:
        return None
    try:
        return int(m.group(0))
    except ValueError:
        return None


def _extract_metrics(html_text: str) -> Dict[str, int]:
    """Extract engagement metrics from a bounded HTML window.

    X embeds the tweet object BEFORE its full_text; callers wanting per-post
    numbers must pass the prefix ending at the post's text.
    """
    out: Dict[str, int] = {}
    for key, pattern in (
        ("likes", _FAV_RE),
        ("retweets", _RT_RE),
        ("replies", _REPLIES_RE),
        ("bookmarks", _BOOKMARKS_RE),
        ("quotes", _QUOTES_RE),
    ):
        match = pattern.search(html_text)
        if match:
            value = _count_value(match.group(1))
            if value is not None:
                out[key] = value
    view_m = re.search(r"view_count:(\d+)", html_text)
    if view_m:
        out["views"] = _count_value(view_m.group(1))
    return out


def _parse_tweet_page(html_text: str, url: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "url": url,
        "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "x_public",
    }

    tweet_id = _TWEET_ID_RE.search(url)
    if not tweet_id:
        id_m = re.search(r'"rest_id"\s*:\s*"(\d{15,20})"', html_text)
        if id_m:
            result["id"] = id_m.group(1)
    else:
        result["id"] = tweet_id.group(1)

    text_m = _FULL_TEXT_RE.search(html_text)
    if text_m:
        raw = text_m.group(1).encode("utf-8", errors="replace").decode("utf-8", errors="replace")
        result["text"] = raw.replace("\\n", "\n")
    else:
        desc_m = re.search(r'<meta[^>]+property="og:description"[^>]+content="([^"]*)"', html_text)
        if desc_m:
            result["text"] = html.unescape(desc_m.group(1))
        else:
            title_m = re.search(r"<title>([^<]*)</title>", html_text)
            if title_m:
                result["text"] = html.unescape(title_m.group(1))

    created_ms = _CREATED_MS_RE.search(html_text)
    if created_ms:
        try:
            created_utc = datetime.fromtimestamp(int(created_ms.group(1)) / 1000, tz=timezone.utc)
            result["createdAt"] = created_utc.isoformat().replace("+00:00", "Z")
            result["createdAtMs"] = int(created_ms.group(1))
        except (ValueError, OSError):
            pass

    _screen = _SCREEN_NAME_RE.search(html_text)
    if _screen:
        result["authorScreenName"] = _screen.group(1)
    _name = _FULL_NAME_RE.search(html_text)
    if _name:
        result["authorName"] = _name.group(1)

    result.update(_extract_metrics(html_text))

    expanded = _EXPANDED_URL_RE.search(html_text)
    if expanded:
        result["expandedUrl"] = expanded.group(1)

    edited = _EDITED_MS_RE.search(html_text)
    if edited:
        result["editInitialTweetId"] = edited.group(1)

    reply_m = re.search(r'reply_to_screen_name:"([^"]+)"', html_text)
    if reply_m:
        result["replyToScreenName"] = reply_m.group(1)
    return result


def _fetch(url: str, timeout: int) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} fetching {url}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error fetching {url}: {exc}") from exc


def _normalize_brief(post: Dict[str, Any]) -> Dict[str, Any]:
    def fmt_count(value: Optional[int]) -> str:
        if value is None:
            return "-"
        if value >= 1_000_000:
            return f"{value / 1_000_000:.1f}M"
        if value >= 1_000:
            return f"{value / 1_000:.1f}K"
        return str(value)

    return {
        "id": post.get("id"),
        "createdAt": post.get("createdAt"),
        "url": post.get("url"),
        "authorName": post.get("authorName"),
        "authorScreenName": post.get("authorScreenName"),
        "text": (post.get("text") or "").replace("\n", " ").strip(),
        "likes": fmt_count(post.get("likes")),
        "retweets": fmt_count(post.get("retweets")),
        "replies": fmt_count(post.get("replies")),
        "bookmarks": fmt_count(post.get("bookmarks")),
        "views": fmt_count(post.get("views")),
        "expandedUrl": post.get("expandedUrl"),
    }


def _print_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2, default=str))


def _print_brief(posts: List[Dict[str, Any]], title: str) -> None:
    print(title)
    print("=" * len(title))
    for idx, post in enumerate(posts, start=1):
        item = _normalize_brief(post)
        who = item["authorName"] or "unknown"
        handle = f"@{item['authorScreenName']}" if item["authorScreenName"] else ""
        print(f"{idx}. {who} {handle}".rstrip())
        print(f"   时间: {item['createdAt'] or '-'}")
        print(f"   指标: likes {item['likes']} | rts {item['retweets']} | replies {item['replies']} | bookmarks {item['bookmarks']} | views {item['views']}")
        print(f"   链接: {item['url'] or '-'}")
        if item["expandedUrl"]:
            print(f"   落地: {item['expandedUrl']}")
        print(f"   内容: {item['text'] or '-'}")


_REST_ID_RE = re.compile(r"rest_id:\"(\d{15,20})\"")
_CREATED_AT_MS_RE = re.compile(r"created_at_ms:(\d{12,14})")


def _closest_before(html_text: str, pos: int, pattern: "re.Pattern[str]") -> Optional[str]:
    best: Optional[str] = None
    best_pos = -1
    for m in pattern.finditer(html_text[:pos]):
        best_pos = m.start()
        best = m.group(1)
    return best if best_pos >= 0 else None


_TWEET_OBJ_RE = re.compile(r'"client:VHdlZXQ6([A-Za-z0-9=]+):(counts|views|details)":\$R\[')
_ID_IN_OBJ_RE = re.compile(r'"client:VHdlZXQ6([A-Za-z0-9=]+):(counts|views|details)"')


def _extract_timeline(html_text: str, handle: str) -> List[Dict[str, Any]]:
    """Parse an /<handle> profile page for the most recent posts.

    X embeds each tweet as objects keyed by client:VHdlZXQ6<id>: (details,
    counts, views). We find every object-id group, then bind the counts /
    details fields by matching id references, and finally emit posts in the
    order their full_text appeared.
    """
    # Collect (obj_key, kind, start) for each tweet object.
    objects: List[Dict[str, Any]] = []
    for m in _TWEET_OBJ_RE.finditer(html_text):
        idm = _ID_IN_OBJ_RE.search(m.group(0))
        if not idm:
            continue
        objects.append({"key": idm.group(1), "kind": idm.group(2), "start": m.start()})

    # Walk objects in page order; details block contains text+time, counts has metrics.
    tweets: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    # Pre-index screen/display names (user core) for author info.
    for obj in objects:
        key = obj["key"]
        if key not in tweets:
            tweets[key] = {"id": "", "text": "", "createdAt": "", "createdAtMs": 0}
            order.append(key)
        seg = html_text[obj["start"]: obj["start"] + 1600]
        if obj["kind"] == "details":
            ft = _FULL_TEXT_RE.search(seg)
            if ft:
                tweets[key]["text"] = ft.group(1).replace("\\n", "\n")
            cm = _CREATED_AT_MS_RE.search(seg)
            if cm:
                try:
                    ts = int(cm.group(1)) / 1000
                    tweets[key]["createdAtMs"] = int(cm.group(1))
                    tweets[key]["createdAt"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")
                except (ValueError, OSError):
                    pass
        elif obj["kind"] == "counts":
            metrics = _extract_metrics(seg)
            if metrics:
                tweets[key].update(metrics)
        elif obj["kind"] == "views":
            vm = re.search(r"view_count:(\d+)", seg)
            if vm:
                val = _count_value(vm.group(1))
                if val is not None:
                    tweets[key]["views"] = val

    # Resolve ids: the tweet object blocks do not embed numeric id directly in
    # the key; find each numeric rest_id that appears near a details block.
    rest_ids = [m for m in re.finditer(r'rest_id:"(\d{15,20})"', html_text)]
    for key, tw in tweets.items():
        # find details block position to check for nearest rest_id prefix
        details_start = -1
        for obj in objects:
            if obj["key"] == key and obj["kind"] == "details":
                details_start = obj["start"]
                break
        if details_start >= 0:
            candidates = [m for m in rest_ids if m.start() < details_start]
            if candidates:
                tw["id"] = candidates[-1].group(1)
        if not tw.get("id"):
            # fall back to decode base64-ish: VHdlZXQ6<id> is base64 of "Tweet:<id>"
            try:
                import base64
                decoded = base64.b64decode(key + "==").decode("utf-8", "replace")
                if ":" in decoded:
                    tw["id"] = decoded.split(":", 1)[1]
            except Exception:
                pass
        tw["url"] = f"https://x.com/{handle}/status/{tw['id']}"

    # screen name / display name from user core block (first occurrence).
    sm = _SCREEN_NAME_RE.search(html_text)
    nm = _FULL_NAME_RE.search(html_text)
    author_screen = sm.group(1) if sm else handle
    author_name = nm.group(1) if nm else ""

    posts: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for key in order:
        tw = tweets[key]
        if not tw["text"]:
            continue
        tw.setdefault("authorScreenName", author_screen)
        if author_name and "authorName" not in tw:
            tw["authorName"] = author_name
        dedupe = tw["id"] or key
        if dedupe in seen:
            continue
        seen.add(dedupe)
        posts.append(tw)
    return posts


def cmd_fetch(args: argparse.Namespace) -> int:
    if not args.handle and not args.url:
        print("Provide --url or --handle", file=sys.stderr)
        return 2
    posts: List[Dict[str, Any]] = []
    try:
        if args.url:
            html_text = _fetch(args.url, args.timeout)
            posts.append(_parse_tweet_page(html_text, args.url))
        else:
            profile_url = f"https://x.com/{args.handle}"
            html_text = _fetch(profile_url, args.timeout)
            posts = _extract_timeline(html_text, args.handle)
            if not posts:
                print(f"No posts found on https://x.com/{args.handle}", file=sys.stderr)
                return 1
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.limit:
        posts = posts[: args.limit]
    if args.json:
        _print_json({"source": "x_public", "posts": posts})
    else:
        _print_brief(posts, f"Twitter/X 公开页: {args.url or ('@' + args.handle)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch Twitter/X public posts by scraping guest pages (no API key needed).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--url", help="Full status URL, e.g. https://x.com/<user>/status/<id>")
    parser.add_argument("--handle", help="X handle without @; fetches recent posts from profile page")
    parser.add_argument("--limit", type=int, default=10, help="Max posts (timeline mode). Default: 10")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--format", dest="fmt", choices=["brief", "json"], default="brief")
    parser.add_argument("--json", action="store_true", help="Shortcut for --format json")
    parser.set_defaults(func=cmd_fetch)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.json:
        args.fmt = "json"
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
