#!/usr/bin/env python3
"""Lightweight zero-dependency web crawlers for popular tech/news sites.

Usage:
    python3 crawlers.py --site hn --limit 5
    python3 crawlers.py --site all --limit 3
    python3 crawlers.py --list-sites
    python3 crawlers.py --site techcrunch --limit 5 --json
"""

import argparse
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

SITES = {
    "hn": "Hacker News front page",
    "36kr": "36氪快讯 (36Kr newsflashes)",
    "techcrunch": "TechCrunch (RSS feed)",
    "producthunt": "Product Hunt daily",
    "zhihu": "知乎热榜 (Zhihu Hot)",
}


def _fetch(url, timeout=15):
    """Fetch URL and return decoded text."""
    req = Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7"})
    with urlopen(req, timeout=timeout) as r:
        data = r.read()
        # Try charset from Content-Type header first
        ct = r.headers.get("Content-Type", "")
        m = re.search(r'charset=([^\s;]+)', ct, re.IGNORECASE)
        if m:
            try:
                return data.decode(m.group(1))
            except (UnicodeDecodeError, LookupError):
                pass
    # Fallback chain: utf-8 -> gbk -> latin-1
    for enc in ("utf-8", "gbk"):
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("latin-1")


def _strip_tags(s):
    """Remove HTML tags from a string."""
    return re.sub(r"<[^>]+>", "", s).strip()


def _unescape(s):
    return html.unescape(s) if s else s


def _std(title, url, source, summary="", published="", score=None, meta=None, partial=False):
    """Build a standard result dict."""
    d = {
        "title": title,
        "url": url,
        "summary": summary,
        "published": published,
        "score": score,
        "source": source,
    }
    if meta:
        d["meta"] = meta
    if partial:
        d["partial"] = True
    return d


def _zero_results_error(source):
    return {"error": "Parser returned 0 results — site may have changed layout", "source": source}


# ---------------------------------------------------------------------------
# Crawlers
# ---------------------------------------------------------------------------

def crawl_hackernews(limit=10):
    """Crawl Hacker News front page."""
    try:
        text = _fetch("https://news.ycombinator.com/")
        titles = re.findall(
            r'class="rank">(\d+)\.</span>.*?class="titleline"><a href="([^"]*)"[^>]*>([^<]+)</a>',
            text, re.DOTALL
        )
        subtexts = re.findall(
            r'class="score"[^>]*>(\d+) point.*?(\d+)&nbsp;comment',
            text, re.DOTALL
        )
        while len(subtexts) < len(titles):
            subtexts.append(("0", "0"))

        if text and len(text) > 1000 and not titles:
            return [_zero_results_error("hackernews")]

        results = []
        for i, (rank, url, title) in enumerate(titles[:limit]):
            pts, cmts = subtexts[i] if i < len(subtexts) else ("0", "0")
            results.append(_std(
                title=_unescape(title),
                url=url,
                source="hackernews",
                score=int(pts),
                meta={"rank": int(rank), "comments": int(cmts)},
            ))
        return results
    except Exception as e:
        return [{"error": f"Hacker News crawl failed: {e}", "source": "hackernews"}]


def crawl_36kr(limit=10):
    """Crawl 36Kr newsflashes (36氪快讯)."""
    try:
        url = "https://gateway.36kr.com/api/missive/flow/newsflash/catalog/list"
        payload = json.dumps({
            "partner_id": "wap",
            "param": {"siteId": 1, "catalogId": 0, "pageSize": limit, "pageEvent": 0, "pageCallback": ""}
        }).encode("utf-8")
        req = Request(url, data=payload, headers={
            "User-Agent": UA,
            "Content-Type": "application/json",
        })
        with urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
        items = data.get("data", {}).get("itemList", [])
        results = []
        for item in items[:limit]:
            d = item.get("templateMaterial", {})
            results.append(_std(
                title=d.get("widgetTitle", ""),
                url=f"https://36kr.com/newsflashes/{d.get('itemId', '')}",
                summary=_strip_tags(d.get("widgetContent", "")),
                published=d.get("publishTime", ""),
                source="36kr",
            ))
        if not results:
            return [_zero_results_error("36kr")]
        return results
    except Exception as e:
        # Fallback: try scraping HTML
        print(f"[WARN] 36kr API failed ({e}), falling back to HTML scraping", file=sys.stderr)
        partial = True
        try:
            text = _fetch("https://36kr.com/newsflashes")
            items = re.findall(r'newsflash-item.*?href="(/newsflashes/\d+)"[^>]*>([^<]+)', text, re.DOTALL)
            if text and len(text) > 500 and not items:
                return [_zero_results_error("36kr")]
            return [_std(
                title=_unescape(t.strip()),
                url=f"https://36kr.com{u}",
                source="36kr",
                partial=True,
            ) for u, t in items[:limit]]
        except Exception as e2:
            return [{"error": f"36kr crawl failed: {e}; fallback also failed: {e2}", "source": "36kr"}]


def crawl_techcrunch(limit=10):
    """Crawl TechCrunch via RSS feed."""
    try:
        text = _fetch("https://techcrunch.com/feed/", timeout=20)
        root = ET.fromstring(text)
        results = []
        for item in root.iter("item"):
            if len(results) >= limit:
                break
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            pub = item.findtext("pubDate", "")
            desc = item.findtext("description", "")
            results.append(_std(
                title=_unescape(title),
                url=link,
                summary=_strip_tags(_unescape(desc))[:200],
                published=pub,
                source="techcrunch",
            ))
        if text and len(text) > 500 and not results:
            return [_zero_results_error("techcrunch")]
        return results
    except Exception as e:
        return [{"error": f"TechCrunch crawl failed: {e}", "source": "techcrunch"}]


def crawl_producthunt(limit=10):
    """Crawl Product Hunt homepage (best effort)."""
    try:
        text = _fetch("https://www.producthunt.com/")
        matches = re.findall(
            r'data-test="post-name"[^>]*>([^<]+)</a>',
            text
        )
        if not matches:
            matches_pair = re.findall(r'"name":"([^"]{2,80})","tagline":"([^"]*)"(?:.*?"slug":"([^"]*)")?', text)
            if matches_pair:
                return [_std(
                    title=n, url=f"https://www.producthunt.com/posts/{s}" if s else "https://www.producthunt.com", source="producthunt",
                    summary=t,
                ) for n, t, s in matches_pair[:limit]]
            if text and len(text) > 1000:
                return [_zero_results_error("producthunt")]
            return [{"error": "Product Hunt uses JS rendering; could not extract products.", "source": "producthunt"}]
        # Try extracting product URLs from data-test links
        url_matches = re.findall(r'href="(/posts/[^"]+)"[^>]*data-test="post-name"[^>]*>([^<]+)', text)
        if url_matches:
            return [_std(title=name.strip(), url=f"https://www.producthunt.com{path}", source="producthunt")
                    for path, name in url_matches[:limit]]
        return [_std(title=m, url="https://www.producthunt.com", source="producthunt")
                for m in matches[:limit]]
    except Exception as e:
        return [{"error": f"Product Hunt crawl failed: {e}", "source": "producthunt"}]


def crawl_zhihu_hot(limit=10):
    """Crawl Zhihu Hot list (知乎热榜)."""
    try:
        text = _fetch(f"https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit={limit}&desktop=true")
        data = json.loads(text)
        results = []
        for item in data.get("data", [])[:limit]:
            target = item.get("target", {})
            results.append(_std(
                title=target.get("title", ""),
                url=f"https://www.zhihu.com/question/{target.get('id', '')}",
                summary=target.get("excerpt", "")[:150],
                source="zhihu",
                meta={"hot_score": item.get("detail_text", "")},
            ))
        if not results:
            return [_zero_results_error("zhihu")]
        return results
    except Exception as e:
        try:
            text = _fetch("https://www.zhihu.com/hot")
            items = re.findall(r'target="_blank"[^>]*href="(https://www.zhihu.com/question/\d+)"[^>]*>([^<]+)', text)
            if text and len(text) > 500 and not items:
                return [_zero_results_error("zhihu")]
            return [_std(title=_unescape(t.strip()), url=u, source="zhihu")
                    for u, t in items[:limit]]
        except Exception as e2:
            return [{"error": f"Zhihu crawl failed (anti-bot likely): {e}; fallback: {e2}", "source": "zhihu"}]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

CRAWLERS = {
    "hn": crawl_hackernews,
    "36kr": crawl_36kr,
    "techcrunch": crawl_techcrunch,
    "producthunt": crawl_producthunt,
    "zhihu": crawl_zhihu_hot,
}


def _wrap_envelope(source, items):
    """Wrap items in a consistent JSON envelope."""
    # Check if items is a list with a single error dict
    err = None
    if items and isinstance(items, list) and len(items) == 1 and "error" in items[0]:
        err = items[0]["error"]
        items = []
    return {"source": source, "items": items, "error": err}


def main():
    parser = argparse.ArgumentParser(description="Lightweight web crawlers for tech/news sites")
    parser.add_argument("--site", type=str, help="Site to crawl (or 'all')")
    parser.add_argument("--limit", type=int, default=10, help="Max items to return")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Output as JSON")
    parser.add_argument("--list-sites", action="store_true", help="List available sites")
    args = parser.parse_args()

    if args.list_sites:
        print("Available sites:")
        for k, v in SITES.items():
            print(f"  {k:15s} {v}")
        return

    if not args.site:
        parser.print_help()
        return

    sites_to_run = list(CRAWLERS.keys()) if args.site == "all" else [args.site]
    all_results = {}

    for site in sites_to_run:
        fn = CRAWLERS.get(site)
        if not fn:
            print(f"Unknown site: {site}. Use --list-sites to see available.", file=sys.stderr)
            continue
        try:
            results = fn(limit=args.limit)
        except Exception as e:
            results = [{"error": str(e), "source": site}]
        all_results[site] = results

    if args.as_json:
        if len(sites_to_run) == 1:
            site = sites_to_run[0]
            envelope = _wrap_envelope(site, all_results.get(site, []))
            print(json.dumps(envelope, ensure_ascii=False, indent=2))
        else:
            envelope = {"sites": {s: _wrap_envelope(s, items) for s, items in all_results.items()}}
            print(json.dumps(envelope, ensure_ascii=False, indent=2))
    else:
        for site, items in all_results.items():
            print(f"\n{'='*60}")
            print(f" {SITES.get(site, site)}")
            print(f"{'='*60}")
            for i, item in enumerate(items, 1):
                if "error" in item and "title" not in item:
                    print(f"  ⚠ {item['error']}")
                    continue
                print(f"  {i}. {item.get('title', '?')}")
                if item.get("url"):
                    print(f"     {item['url']}")
                extras = {k: v for k, v in item.items()
                          if k not in ("title", "url", "source") and v}
                if extras:
                    print(f"     {extras}")


if __name__ == "__main__":
    main()
