#!/usr/bin/env python3
import argparse
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
from textwrap import shorten
from typing import Dict, List, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
ARXIV_NS = {"atom": "http://www.w3.org/2005/Atom"}
NEWS_SOURCES = {
    "reuters": {"domain": "reuters.com", "feed": None},
    "bbc": {"domain": "bbc.com", "feed": "https://feeds.bbci.co.uk/news/world/rss.xml"},
    "ap": {"domain": "apnews.com", "feed": None},
    "cnn": {"domain": "cnn.com", "feed": "http://rss.cnn.com/rss/edition_world.rss"},
    "fox": {"domain": "foxnews.com", "feed": "https://moxie.foxnews.com/google-publisher/world.xml"},
    "nytimes": {"domain": "nytimes.com", "feed": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"},
    "cctv": {"domain": "cctv.com", "feed": None},
}
SOURCE_PRESETS = {
    "global": ["reuters", "bbc", "ap", "cnn", "fox", "nytimes", "cctv"],
    "western": ["reuters", "bbc", "ap", "cnn", "fox", "nytimes"],
    "china": ["cctv"],
}
QUERY_PRESETS = {
    "global-brief": "world news -sports -baseball -olympic -entertainment -celebrity",
    "china-brief": "China world economy diplomacy trade policy -sports -entertainment",
    "tech-brief": "AI chips cloud software regulation startups -sports -entertainment",
}


def fetch_text(url: str, timeout: int = 20) -> str:
    req = Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "ignore")


def clean(text: Optional[str]) -> str:
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(unescape(text).replace("\xa0", " ").split())


def resolve_query(query: str, preset: Optional[str]) -> str:
    base = (query or "").strip()
    preset_text = QUERY_PRESETS.get((preset or "").strip().lower(), "") if preset else ""
    if base and preset_text:
        return f"{base} {preset_text}".strip()
    return (base or preset_text).strip()


def with_site(query: str, site: Optional[str]) -> str:
    base = (query or "").strip()
    if not site:
        return base
    site = site.strip()
    if not site:
        return base
    if base:
        return f"{base} site:{site}"
    return f"site:{site}"


def parse_published(value: str) -> datetime:
    value = clean(value)
    if not value:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            continue
    return datetime.fromtimestamp(0, tz=timezone.utc)


def dedupe_items(items: List[Dict]) -> List[Dict]:
    seen = set()
    out = []
    for item in items:
        key = (clean(item.get("url", "")).lower(), clean(item.get("title", "")).lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def parse_sources_arg(sources: Optional[str], preset: Optional[str]) -> List[str]:
    chosen: List[str] = []
    if preset:
        chosen.extend(SOURCE_PRESETS.get(preset, []))
    if sources:
        for part in sources.split(","):
            name = part.strip().lower()
            if not name:
                continue
            chosen.append(name)
    normalized = []
    seen = set()
    for name in chosen:
        if name in NEWS_SOURCES and name not in seen:
            normalized.append(name)
            seen.add(name)
    return normalized


def build_news_query(query: str, site: Optional[str], days: int, hours: int) -> str:
    q = with_site(query, site)
    if hours > 0:
        q = f"{q} when:{hours}h".strip()
    elif days > 0:
        q = f"{q} when:{days}d".strip()
    return q


def cutoff_time(days: int, hours: int) -> datetime:
    now = datetime.now(timezone.utc)
    if hours > 0:
        return now.replace(microsecond=0) - timedelta(hours=hours)
    return now.replace(microsecond=0) - timedelta(days=days)


def filter_recent(items: List[Dict], days: int, hours: int) -> List[Dict]:
    threshold = cutoff_time(days, hours)
    out = []
    for item in items:
        if parse_published(item.get('published', '')) >= threshold:
            out.append(item)
    return out


def fetch_source_feed(feed_url: str, limit: int, source_label: str, timeout: int) -> List[Dict]:
    root = ET.fromstring(fetch_text(feed_url, timeout=timeout))
    items = []
    for item in root.findall('./channel/item')[: max(limit * 3, limit)]:
        items.append({
            'title': clean(item.findtext('title')),
            'url': clean(item.findtext('link')),
            'snippet': clean(item.findtext('description')),
            'published': clean(item.findtext('pubDate')),
            'source': source_label,
            'site': NEWS_SOURCES.get(source_label, {}).get('domain', ''),
        })
    return items


def search_web(query: str, limit: int, site: Optional[str], timeout: int) -> List[Dict]:
    q = with_site(query, site)
    url = f"https://www.bing.com/search?format=rss&cc=US&setlang=en-US&q={quote(q)}"
    root = ET.fromstring(fetch_text(url, timeout=timeout))
    items = []
    for item in root.findall("./channel/item")[:limit]:
        items.append({
            "title": clean(item.findtext("title")),
            "url": clean(item.findtext("link")),
            "snippet": clean(item.findtext("description")),
            "published": clean(item.findtext("pubDate")),
            "source": "bing-rss",
        })
    return items


def search_news_single(query: str, limit: int, site: Optional[str], days: int, hours: int, hl: str, gl: str, ceid: str, timeout: int, source_label: Optional[str] = None) -> List[Dict]:
    q = build_news_query(query, site, days, hours)
    url = f"https://news.google.com/rss/search?q={quote(q)}&hl={quote(hl)}&gl={quote(gl)}&ceid={quote(ceid)}"
    root = ET.fromstring(fetch_text(url, timeout=timeout))
    items = []
    for item in root.findall("./channel/item")[:limit]:
        items.append({
            "title": clean(item.findtext("title")),
            "url": clean(item.findtext("link")),
            "snippet": clean(item.findtext("description")),
            "published": clean(item.findtext("pubDate")),
            "source": source_label or "google-news-rss",
            "site": site or "",
        })
    return items


def search_news(query: str, limit: int, site: Optional[str], sources: List[str], days: int, hours: int, hl: str, gl: str, ceid: str, timeout: int, per_source_limit: int, use_feeds: bool) -> List[Dict]:
    if sources:
        merged = []
        each_limit = max(1, min(per_source_limit, 10))
        for source_name in sources:
            meta = NEWS_SOURCES[source_name]
            if use_feeds and meta.get('feed'):
                source_items = fetch_source_feed(meta['feed'], each_limit, source_name, timeout)
                source_items = filter_recent(source_items, days, hours)
                merged.extend(source_items[:each_limit])
            else:
                merged.extend(search_news_single(
                    query=query,
                    limit=each_limit,
                    site=meta.get('domain'),
                    days=days,
                    hours=hours,
                    hl=hl,
                    gl=gl,
                    ceid=ceid,
                    timeout=timeout,
                    source_label=source_name,
                ))
        merged = dedupe_items(merged)
        merged.sort(key=lambda item: parse_published(item.get("published", "")), reverse=True)
        return merged[:limit]
    items = search_news_single(query, limit, site, days, hours, hl, gl, ceid, timeout)
    items = dedupe_items(items)
    items.sort(key=lambda item: parse_published(item.get("published", "")), reverse=True)
    return items[:limit]


def search_wiki(query: str, limit: int, wiki_lang: str, timeout: int) -> List[Dict]:
    url = (
        f"https://{wiki_lang}.wikipedia.org/w/api.php?action=opensearch&format=json"
        f"&limit={limit}&search={quote(query)}"
    )
    data = json.loads(fetch_text(url, timeout=timeout))
    titles = data[1] if len(data) > 1 else []
    descs = data[2] if len(data) > 2 else []
    urls = data[3] if len(data) > 3 else []
    items = []
    for title, desc, link in zip(titles, descs, urls):
        items.append({
            "title": clean(title),
            "url": clean(link),
            "snippet": clean(desc),
            "source": f"wikipedia-{wiki_lang}",
        })
    return items


def search_arxiv(query: str, limit: int, timeout: int) -> List[Dict]:
    url = (
        "https://export.arxiv.org/api/query?"
        f"search_query=all:{quote(query)}&start=0&max_results={limit}&sortBy=relevance&sortOrder=descending"
    )
    root = ET.fromstring(fetch_text(url, timeout=timeout))
    items = []
    for entry in root.findall("atom:entry", ARXIV_NS):
        authors = [clean(author.findtext("atom:name", default="", namespaces=ARXIV_NS)) for author in entry.findall("atom:author", ARXIV_NS)]
        items.append({
            "title": clean(entry.findtext("atom:title", default="", namespaces=ARXIV_NS)),
            "url": clean(entry.findtext("atom:id", default="", namespaces=ARXIV_NS)),
            "snippet": clean(entry.findtext("atom:summary", default="", namespaces=ARXIV_NS)),
            "published": clean(entry.findtext("atom:published", default="", namespaces=ARXIV_NS)),
            "authors": authors,
            "source": "arxiv",
        })
    return items


def print_markdown(mode: str, query: str, items: List[Dict]) -> None:
    print(f"# {mode} results")
    print(f"query: {query}")
    print(f"count: {len(items)}")
    print()
    if not items:
        print("No results.")
        return
    for idx, item in enumerate(items, start=1):
        print(f"{idx}. {item.get('title') or '(untitled)'}")
        if item.get("url"):
            print(f"   URL: {item['url']}")
        if item.get("source"):
            print(f"   Source: {item['source']}")
        if item.get("published"):
            print(f"   Published: {item['published']}")
        if item.get("authors"):
            print(f"   Authors: {', '.join(item['authors'][:8])}")
        snippet = clean(item.get("snippet", ""))
        if snippet:
            print(f"   Snippet: {shorten(snippet, width=260, placeholder=' …')}")
        print()


def main() -> int:
    parser = argparse.ArgumentParser(description="No-card fallback search for OpenClaw")
    parser.add_argument("query", nargs="?", default="", help="search query (optional for feed-based latest news runs)")
    parser.add_argument("--mode", choices=["web", "news", "wiki", "arxiv"], default="web")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--site", help="optional site filter, e.g. reuters.com")
    parser.add_argument("--query-preset", choices=sorted(QUERY_PRESETS.keys()), help="named query preset for cleaner brief generation")
    parser.add_argument("--sources", help="comma-separated news sources, e.g. reuters,bbc,ap,cnn,fox,nytimes,cctv")
    parser.add_argument("--source-preset", choices=sorted(SOURCE_PRESETS.keys()), help="named news source preset")
    parser.add_argument("--per-source-limit", type=int, default=3, help="news items fetched per source before dedupe")
    parser.add_argument("--use-feeds", action="store_true", help="prefer official source RSS feeds when available (best for latest global briefs)")
    parser.add_argument("--days", type=int, default=7, help="news lookback window in days")
    parser.add_argument("--hours", type=int, default=0, help="news lookback window in hours (overrides --days)")
    parser.add_argument("--hl", default="en-US", help="Google News hl param")
    parser.add_argument("--gl", default="US", help="Google News gl param")
    parser.add_argument("--ceid", default="US:en", help="Google News ceid param")
    parser.add_argument("--wiki-lang", default="en", help="Wikipedia language subdomain")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--json", action="store_true", help="output JSON instead of markdown")
    args = parser.parse_args()

    limit = max(1, min(int(args.limit), 20))
    resolved_query = resolve_query(args.query, args.query_preset)
    news_sources = parse_sources_arg(args.sources, args.source_preset)
    try:
        if args.mode == "web":
            items = search_web(resolved_query, limit, args.site, args.timeout)
        elif args.mode == "news":
            items = search_news(
                query=resolved_query,
                limit=limit,
                site=args.site,
                sources=news_sources,
                days=max(1, args.days),
                hours=max(0, args.hours),
                hl=args.hl,
                gl=args.gl,
                ceid=args.ceid,
                timeout=args.timeout,
                per_source_limit=args.per_source_limit,
                use_feeds=args.use_feeds,
            )
        elif args.mode == "wiki":
            items = search_wiki(resolved_query, limit, args.wiki_lang, args.timeout)
        else:
            items = search_arxiv(resolved_query, limit, args.timeout)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "mode": args.mode, "query": resolved_query}, ensure_ascii=False))
        return 1

    if args.json:
        print(json.dumps({"mode": args.mode, "query": resolved_query, "count": len(items), "results": items}, ensure_ascii=False, indent=2))
    else:
        print_markdown(args.mode, resolved_query, items)
    return 0


if __name__ == "__main__":
    sys.exit(main())
