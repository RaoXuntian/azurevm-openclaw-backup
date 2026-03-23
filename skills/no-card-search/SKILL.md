---
name: no-card-search
description: Lightweight no-credit-card fallback search for web, news, Wikipedia, and arXiv using public endpoints plus official news RSS feeds where available. Use when web_search is unavailable, Gemini is rate-limited (429), the user has no paid search API, or you need low-cost search before fetching/summarizing pages. Good triggers: "search without API billing", "Gemini 429", "no credit card", "find recent news", "global news brief", "bilingual news brief", "look up a concept", "search papers", or "search site:example.com".
---

# No Card Search

Use this skill as a fallback layer behind native `web_search`.

## Quick start

Search only:

```bash
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py --mode web "OpenClaw GitHub"
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py --mode news "OpenAI" --days 7
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py --mode wiki "Retrieval-augmented generation"
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py --mode arxiv "retrieval augmented generation"
```

Auto-brief:

```bash
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/news_brief.py --use-feeds
```

## Search modes

### 1. General web search
Use `search.py --mode web`.

- Backend: Bing RSS search
- Best for: docs, homepages, product pages, official repos, basic site filtering

```bash
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py --mode web "OpenClaw docs" --site docs.openclaw.ai
```

### 2. Recent news search
Use `search.py --mode news`.

Backends:
- Google News RSS
- Official source feeds when `--use-feeds` is enabled and a source has a known RSS feed

```bash
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py --mode news --hours 6 "world"
```

### 3. Entity / concept lookup
Use `search.py --mode wiki`.

```bash
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py --mode wiki "OpenAI" --wiki-lang en
```

### 4. Paper search
Use `search.py --mode arxiv`.

```bash
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py --mode arxiv "Mixture of Experts"
```

## Curated news sources

Supported named sources:
- `reuters`
- `bbc`
- `ap`
- `cnn`
- `fox`
- `nytimes`
- `cctv`

Source presets:
- `global`
- `western`
- `china`

Preferred global brief search:

```bash
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/search.py \
  --mode news \
  --source-preset global \
  --use-feeds \
  --hours 6 \
  --limit 12 \
  --per-source-limit 2
```

## Auto bilingual brief workflow

Use `news_brief.py` when the user wants a finished **global news brief** instead of raw search results.

What it does:
- runs multiple subqueries automatically (for example global brief + Iran + markets + China policy)
- merges results across sources
- dedupes repeated headlines
- filters common noise (sports / celebrity / low-signal items)
- clusters stories into themes
- outputs **中文简报 + English Brief**

Recommended command:

```bash
python3 /home/xtrao/.openclaw/skills/no-card-search/scripts/news_brief.py \
  --use-feeds \
  --source-preset global \
  --hours 6
```

## Best practices

1. If native `web_search` is healthy and cheap enough, use it.
2. If Gemini is 429 / no paid API is available / the user explicitly wants a no-card path, use this skill.
3. For global briefs, prefer `news_brief.py --use-feeds --source-preset global --hours N`.
4. For raw search exploration, use `search.py` first, then `web_fetch` only the top URLs worth reading.
5. For final brief output, present the generated **Chinese brief first, then English brief**.

## Useful flags

### search.py
- `--limit`
- `--site example.com`
- `--sources reuters,bbc,...`
- `--source-preset global|western|china`
- `--use-feeds`
- `--per-source-limit`
- `--days N`
- `--hours N`
- `--query-preset global-brief|china-brief|tech-brief`
- `--json`

### news_brief.py
- `--hours N`
- `--days N`
- `--source-preset`
- `--sources`
- `--use-feeds`
- `--max-themes`
- `--json`

## Notes

- This skill uses public endpoints, so reliability is best-effort.
- Official feeds improve quality, but not every source exposes a clean public RSS feed.
- Google News RSS links may be redirect-style links; use `web_fetch` on directly usable article URLs when possible.
- The automatic brief is much cleaner than raw aggregation, but still not equal to a paid research API.
