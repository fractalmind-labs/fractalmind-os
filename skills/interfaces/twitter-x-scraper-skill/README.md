# twitter-x-scraper-skill

Fetch Twitter/X posts with a two-layer strategy:

1. **Public page scraper (primary)** — `scripts/x_public_fetch.py` fetches
   guest HTML from `x.com` and parses the embedded page data. No API key, no
   login, no quota. Supports single-post URLs and per-account timelines.
2. **twitterapi.io (fallback)** — `scripts/twitterapi_news.py` wraps the
   twitterapi.io API for advanced search, user lookup and timeline when the
   public page is unavailable or search discovery is needed.

## Install

Point an agent skill loader at this directory, or copy `SKILL.md` together
with `scripts/`, `references/` and `agents/` into your skill home.

## Usage

```bash
# Primary: single post
python3 scripts/x_public_fetch.py --url "https://x.com/acct/status/1234567890123456789"

# Primary: account timeline
python3 scripts/x_public_fetch.py --handle somehandle --limit 10

# Fallback: twitterapi.io advanced search (requires TWITTERAPI_IO_KEY)
python3 scripts/twitterapi_news.py search --query 'OpenAI OR Anthropic' --hours 24 --limit 5
```

## Credentials

Only the fallback path needs credentials: `TWITTERAPI_IO_KEY`,
`TWITTERAPI_IO_USER_ID`, `TWITTERAPI_IO_BASE_URL`, or an env file passed via
`--env-file`. Never commit secrets.

## Design notes

- The public scraper is preferred because it needs no quota and no third-party
  provider.
- Parsing relies on the X guest page HTML structure; if X changes it and key
  fields go missing, fall back to the twitterapi.io path as documented in
  `SKILL.md`.
- Twitter/X is a fast clue source, not a final fact source. Cross-check with
  official announcements or mainstream media before publishing externally.
