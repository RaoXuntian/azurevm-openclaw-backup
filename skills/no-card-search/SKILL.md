---
name: no-card-search
description: >
  Zero-cost information retrieval: web search, news, Wikipedia, arXiv, HackerNews,
  GitHub Trending, site crawlers, and browser-based search fallback — all without
  paid APIs. Use as the PRIMARY search method before web_search. Use when searching
  the web, finding news, looking up concepts, browsing tech trends, or crawling
  specific sites. Good triggers: "search", "find", "news", "what's trending",
  "HackerNews", "GitHub trending", "crawl", "look up", "search papers",
  "global news brief", "bilingual news brief", "tech brief".
---

# No Card Search v2

Zero-cost information retrieval for agents. **Use this as the primary search method; `web_search` is the fallback.**

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/search.py` | Multi-mode search: web, news, wiki, arxiv, hn, github |
| `scripts/browser_search.py` | DuckDuckGo/Bing HTML search (browser-free fallback) |
| `scripts/crawlers.py` | Site-specific crawlers: HN, 36kr, TechCrunch, ProductHunt, Zhihu |
| `scripts/news_brief.py` | Auto bilingual news brief generator |

## Quick start

```bash
# Web search (Bing RSS)
python3 scripts/search.py --mode web "OpenClaw GitHub"

# News (Google News RSS + official feeds)
python3 scripts/search.py --mode news "world" --hours 6 --use-feeds

# HackerNews top stories
python3 scripts/search.py --mode hn --limit 10

# GitHub Trending
python3 scripts/search.py --mode github --limit 10 --language python

# Wikipedia lookup
python3 scripts/search.py --mode wiki "Retrieval-augmented generation"

# arXiv papers
python3 scripts/search.py --mode arxiv "mixture of experts"

# Browser-based search (DDG → Bing fallback)
python3 scripts/browser_search.py "query" --limit 5

# Site crawlers
python3 scripts/crawlers.py --site hn --limit 10
python3 scripts/crawlers.py --site techcrunch --limit 10
python3 scripts/crawlers.py --site 36kr --limit 10
python3 scripts/crawlers.py --site all --limit 5

# Auto bilingual news brief
python3 scripts/news_brief.py --use-feeds --source-preset global --hours 6
```

## Search modes (search.py)

| Mode | Backend | Best for |
|------|---------|----------|
| `web` | Bing RSS | General web search, docs, repos |
| `news` | Google News RSS + official feeds | Recent news, headlines |
| `wiki` | Wikipedia OpenSearch | Concepts, entities, definitions |
| `arxiv` | arXiv API | Academic papers |
| `hn` | HackerNews Firebase API | Tech community trends |
| `github` | GitHub Trending HTML | Open source trends, repos |

## Browser search (browser_search.py)

Fallback when all other methods fail. Fetches and parses search engine HTML directly.

- **Primary:** DuckDuckGo HTML (`html.duckduckgo.com`)
- **Fallback:** Bing HTML
- DDG may serve CAPTCHAs in some environments; Bing fallback handles this

```bash
python3 scripts/browser_search.py "query" --limit 5 --json
```

## Site crawlers (crawlers.py)

Direct crawlers for popular sites. Unified output format with consistent JSON envelope.

| Site | Source | Reliability |
|------|--------|-------------|
| `hn` | HackerNews HTML | ✅ Stable |
| `techcrunch` | TechCrunch RSS | ✅ Stable |
| `36kr` | 36Kr API + HTML fallback | 🟡 API may fail, HTML fallback |
| `producthunt` | ProductHunt HTML | 🟡 JS-heavy, may fail |
| `zhihu` | Zhihu API + HTML | 🔴 Anti-bot, often blocked |

```bash
python3 scripts/crawlers.py --site hn --limit 5 --json
python3 scripts/crawlers.py --site all --limit 3 --json
python3 scripts/crawlers.py --list-sites
```

JSON output format (single site):
```json
{"source": "hn", "items": [...], "error": null}
```

JSON output format (all sites):
```json
{"sites": {"hn": {"items": [...], "error": null}, ...}}
```

## News sources

Curated sources with optional RSS feeds:

| Source | Feed | Notes |
|--------|------|-------|
| reuters | site-filtered | via Google News |
| bbc | ✅ RSS | BBC World |
| ap | site-filtered | via Google News |
| cnn | ✅ RSS | CNN World |
| fox | ✅ RSS | Fox World |
| nytimes | ✅ RSS | NYT World |
| cctv | site-filtered | via Google News |
| xinhua | ✅ RSS | 新华社 Politics |
| cailianshe | site-filtered | 财联社 via Google News |
| thepaper | site-filtered | 澎湃新闻 via Google News |

Source presets: `global`, `western`, `china`

## Search priority (for agents)

1. **Primary:** `no-card-search` scripts (this skill)
2. **Fallback:** `web_search` (Gemini) — only when this skill's results are insufficient
3. **Never retry** `web_search` on 429 — use this skill instead

## Useful flags

### search.py
`--mode`, `--limit`, `--site`, `--sources`, `--source-preset`, `--use-feeds`,
`--per-source-limit`, `--days`, `--hours`, `--query-preset`, `--language` (github only), `--json`

### browser_search.py
`--limit`, `--json`

### crawlers.py
`--site`, `--limit`, `--json`, `--list-sites`

### news_brief.py
`--hours`, `--days`, `--source-preset`, `--sources`, `--use-feeds`, `--max-themes`, `--json`
