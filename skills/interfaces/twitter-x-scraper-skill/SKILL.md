---
name: twitter-x-scraper
description: Fetch Twitter/X posts and timelines for news discovery and verification. Use when you need the content of a specific X post URL, recent posts from an account, or quick social signals on AI, semiconductors, cloud, US policy, or company news. Prefers the public X page scraper (no key, no quota) and falls back to twitterapi.io only when the public page is unavailable or search discovery is required.
license: Apache-2.0
allowed-tools: [Read, Write, Bash]
---

# twitter-x-scraper

Fetch Twitter/X content with a two-layer strategy:

1. **Public page scraper (primary)** — `scripts/x_public_fetch.py` fetches the
   guest HTML of `x.com` and parses the embedded page data. No API key, no
   login, no provider quota.
2. **twitterapi.io (fallback)** — `scripts/twitterapi_news.py` wraps the
   twitterapi.io API for advanced search, user lookup and timelines when the
   public page is not usable or search discovery is needed.

Twitter/X is a fast clue source, not a final fact source. Cross-check with
official announcements or mainstream media before publishing externally.

## When to use

Use this skill when you need to:

- read the content of a specific X post given its URL (`https://x.com/<user>/status/<id>`)
- list the latest posts from an account
- collect first-hand social signals for a news brief
- verify recent posts on a topic or from an account

## Primary path: public page scraper

Script: `scripts/x_public_fetch.py`

```bash
# Single post (most common): pass the full status URL
python3 "<skill_dir>/scripts/x_public_fetch.py" \
  --url "https://x.com/acct/status/1234567890123456789?s=20"

# Account timeline
python3 "<skill_dir>/scripts/x_public_fetch.py" \
  --handle somehandle --limit 10
```

Output fields (JSON via `--json`): `id`, `createdAt`, `authorName`,
`authorScreenName`, `text`, `expandedUrl`, `likes`, `retweets`, `replies`,
`bookmarks`, `views` (when present).

Suitability and limits:

- Guest HTML embeds enough data for single posts and timelines; usually no
  extra key is needed.
- Not suitable for: login-only pages, deleted/private posts, or advanced
  search discovery (the public page cannot search).
- Page parsing depends on X's HTML structure; if X changes it and key fields
  go missing, degrade to the twitterapi.io path below.

## Fallback path: twitterapi.io

Script: `scripts/twitterapi_news.py`

```bash
# Search the last 24h for a topic
python3 "<skill_dir>/scripts/twitterapi_news.py" search \
  --query 'OpenAI OR Anthropic' --hours 24 --limit 5

# Account timeline
python3 "<skill_dir>/scripts/twitterapi_news.py" timeline \
  --user-name OpenAI --limit 5
```

Credentials: read from environment variables `TWITTERAPI_IO_KEY`,
`TWITTERAPI_IO_USER_ID`, `TWITTERAPI_IO_BASE_URL`; otherwise from an env file
(defaults to `<agent-home>/state/private/twitterapi-io.env`, overridable with
`--env-file`). Never commit secrets to a repository.

Fall back when:

1. `x_public_fetch.py` returns empty or misses key fields (text, author, time);
2. search discovery is needed (public page cannot search);
3. the X public page structure changed and parsing fails.

## Decision flow

```text
Have a single post URL?
  ├─ yes → x_public_fetch.py --url <url> (primary)
  │        └─ empty/missing key fields → twitterapi_news.py timeline/search
  └─ no  → need search?
            ├─ yes → twitterapi_news.py search/news-brief
            └─ no  → x_public_fetch.py --handle <account> (timeline)
```

## Verification principles

1. Confirm the main thread with official sources or trustworthy mainstream
   media first.
2. Then search keywords or inspect company/founder/reporter timelines.
3. Keep only clues with timestamps, original post links, strong relevance, and
   credible sources.
4. Treat X posts as leads, not facts; do not treat engagement counts as
   credibility, and do not treat vendor performance claims as independently
   verified results.
5. Fetch 3–5 posts by default; do not paginate unbounded; search first for a
   topic, then go deeper on a timeline when needed.

## Scripts

- `scripts/x_public_fetch.py` — fetches public `x.com` pages and parses
  embedded data. No API key, no quota.
- `scripts/twitterapi_news.py` — twitterapi.io wrapper for search, timeline,
  user info, and news-brief output.

## References

See [references/twitterapi-endpoints.md](references/twitterapi-endpoints.md)
for endpoint paths, parameters, and output fields.
