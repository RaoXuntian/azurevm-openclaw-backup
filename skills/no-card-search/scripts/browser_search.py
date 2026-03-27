#!/usr/bin/env python3
"""Browser-based web search using DuckDuckGo and Bing HTML pages.

Uses only Python stdlib. No API keys required.
"""

import argparse
import json
import re
import sys
from html import unescape
from urllib.error import URLError
from urllib.parse import quote_plus, unquote, urlparse, parse_qs
from urllib.request import Request, urlopen

UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
TIMEOUT = 10


def _fetch(url):
    """Fetch a URL and return decoded text."""
    req = Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urlopen(req, timeout=TIMEOUT) as resp:
        data = resp.read()
    return data.decode("utf-8", errors="replace")


def _strip_tags(html_str):
    """Remove HTML tags and decode entities."""
    return unescape(re.sub(r"<[^>]+>", "", html_str)).strip()


def _extract_ddg_url(href):
    """Extract the actual URL from a DDG redirect link."""
    if "duckduckgo.com" in href and "uddg=" in href:
        m = parse_qs(urlparse(href).query).get("uddg")
        if m:
            return m[0]
    return href


def _extract_bing_url(href):
    """Extract the actual URL from a Bing tracking redirect."""
    if "bing.com" in href and "/ck/a?" in href:
        # Try &u= parameter
        m = re.search(r'[?&]u=([^&]+)', href)
        if m:
            decoded = unquote(m.group(1))
            # Bing often encodes as a1<base64> or a!<url>
            if decoded.startswith("a!"):
                decoded = decoded[2:]
            elif decoded.startswith("a1"):
                import base64
                try:
                    decoded = base64.b64decode(decoded[2:] + "==").decode("utf-8", errors="replace")
                except Exception:
                    pass
            if decoded.startswith("http"):
                return decoded
    return href


def search_duckduckgo(query, limit=5):
    """Search DuckDuckGo HTML-only endpoint."""
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    try:
        html = _fetch(url)
    except (URLError, TimeoutError, OSError) as e:
        print(f"[browser_search] DDG fetch error: {e}", file=sys.stderr)
        return []

    results = []
    # Split on result divs - allow extra classes/attributes
    blocks = re.split(r'<div\s[^>]*class="[^"]*result\b', html)
    for block in blocks[1:]:
        if len(results) >= limit:
            break
        # Title + URL - tolerate varied attribute order
        tm = re.search(r'class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', block, re.S)
        if not tm:
            tm = re.search(r'href="([^"]*)"[^>]*class="result__a"[^>]*>(.*?)</a>', block, re.S)
        if not tm:
            continue
        raw_url = unescape(tm.group(1))
        title = _strip_tags(tm.group(2))
        if not title:
            continue
        actual_url = _extract_ddg_url(raw_url)
        # Snippet - try multiple patterns
        snippet = ""
        for pat in [
            r'class="result__snippet"[^>]*>(.*?)</(?:a|td|div)>',
            r'class="[^"]*snippet[^"]*"[^>]*>(.*?)</(?:a|td|div)>',
            r'<td\s[^>]*class="result__snippet"[^>]*>(.*?)</td>',
        ]:
            sm = re.search(pat, block, re.S)
            if sm:
                snippet = _strip_tags(sm.group(1))
                break
        results.append({"title": title, "url": actual_url, "snippet": snippet, "source": "duckduckgo"})

    if not results and len(html) > 1000:
        print(f"[browser_search] WARNING: DDG returned {len(html)} bytes but parsed 0 results", file=sys.stderr)
    return results


def search_bing(query, limit=5):
    """Search Bing HTML as fallback."""
    url = f"https://www.bing.com/search?q={quote_plus(query)}&count={limit}"
    try:
        html = _fetch(url)
    except (URLError, TimeoutError, OSError) as e:
        print(f"[browser_search] Bing fetch error: {e}", file=sys.stderr)
        return []

    results = []
    blocks = re.split(r'<li\s+class="b_algo"', html)
    for block in blocks[1:]:
        if len(results) >= limit:
            break
        # Bing h2 may have class attrs
        tm = re.search(r'<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not tm:
            continue
        raw_link = unescape(tm.group(1))
        link = _extract_bing_url(raw_link)
        title = _strip_tags(tm.group(2))
        sm = re.search(r'<p[^>]*>(.*?)</p>', block, re.S)
        snippet = _strip_tags(sm.group(1)) if sm else ""
        results.append({"title": title, "url": link, "snippet": snippet, "source": "bing"})

    if not results and len(html) > 1000:
        print(f"[browser_search] WARNING: Bing returned {len(html)} bytes but parsed 0 results", file=sys.stderr)
    return results


def fallback_web_search(query, limit=5):
    """Search the web using DuckDuckGo, falling back to Bing on failure."""
    results = search_duckduckgo(query, limit)
    if results:
        return results
    return search_bing(query, limit)


def main():
    parser = argparse.ArgumentParser(description="Web search via DuckDuckGo/Bing HTML")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--limit", type=int, default=5, help="Max results (default 5)")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Output as JSON")
    args = parser.parse_args()

    results = fallback_web_search(args.query, args.limit)

    if args.as_json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        if not results:
            print("No results found.")
            return
        for i, r in enumerate(results, 1):
            print(f"{i}. {r['title']}")
            print(f"   {r['url']}")
            if r["snippet"]:
                print(f"   {r['snippet'][:120]}")
            print()


if __name__ == "__main__":
    main()
