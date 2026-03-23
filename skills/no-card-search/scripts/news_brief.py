#!/usr/bin/env python3
import argparse
import json
import re
from collections import defaultdict
from typing import Dict, List, Tuple

from search import search_news, parse_sources_arg, resolve_query, parse_published

SOURCE_WEIGHTS = {
    "reuters": 4.0,
    "ap": 3.8,
    "bbc": 3.6,
    "nytimes": 3.5,
    "cnn": 3.0,
    "fox": 2.6,
    "cctv": 2.6,
}

THEME_RULES: List[Tuple[str, List[str]]] = [
    ("geopolitics", [
        "iran", "iranian", "tehran", "israel", "gaza", "war", "strike", "military", "missile", "sanction", "diplom", "ceasefire", "conflict", "lebanon", "hamas"
    ]),
    ("markets", [
        "oil", "stocks", "shares", "dow", "futures", "economy", "trade", "tariff", "inflation", "growth", "market", "markets"
    ]),
    ("china", [
        "china", "chinese", "beijing", "premier", "cctv", "policy"
    ]),
    ("accident", [
        "airport", "plane", "collision", "crash", "fire truck", "air canada", "la guardia", "laguardia"
    ]),
    ("society", [
        "resident", "residents", "humanitarian", "food prices", "panic buying"
    ]),
]

STRONG_KEEP = [
    "iran", "iranian", "tehran", "israel", "gaza", "war", "strike", "oil", "stocks", "shares", "dow", "economy", "trade", "premier", "policy", "airport", "collision", "crash", "tariff", "sanction", "market", "markets"
]

NOISE_HINTS = [
    "onlyfans", "pokemon", "wordle", "baseball", "olympic", "pitcher", "sports", "celebrity", "festival", "sci-fi writers", "katie ledecky"
]

THEME_LABELS = {
    "geopolitics": ("中东 / 地缘政治", "Middle East / Geopolitics"),
    "markets": ("市场 / 宏观", "Markets / Macro"),
    "china": ("中国 / 政策口径", "China / Policy Signaling"),
    "accident": ("事故 / 交通", "Accidents / Transport"),
    "society": ("社会 / 民生外溢", "Society / Spillover"),
    "other": ("其他", "Other"),
}

MARKET_SPECIAL = [
    "oil falls", "shares rebound", "stocks jump", "dow soars", "markets shoot higher", "market rally", "risk-on", "risk off"
]


def item_text(item: Dict) -> str:
    return f"{item.get('title','')} {item.get('snippet','')}".lower()


def contains_keyword(text: str, keyword: str) -> bool:
    keyword = keyword.lower()
    if " " in keyword or "-" in keyword:
        return keyword in text
    return re.search(rf"\b{re.escape(keyword)}\b", text) is not None


def contains_any(text: str, keywords: List[str]) -> bool:
    return any(contains_keyword(text, kw) for kw in keywords)


def is_noise(item: Dict) -> bool:
    text = item_text(item)
    if contains_any(text, STRONG_KEEP):
        return False
    return contains_any(text, NOISE_HINTS)


def classify_theme(item: Dict) -> str:
    text = item_text(item)
    if contains_any(text, MARKET_SPECIAL):
        return "markets"
    for theme, keywords in THEME_RULES:
        if contains_any(text, keywords):
            return theme
    return "other"


def source_weight(item: Dict) -> float:
    return SOURCE_WEIGHTS.get(str(item.get("source", "")).lower(), 2.0)


def score_item(item: Dict) -> float:
    theme = classify_theme(item)
    theme_bonus = {
        "geopolitics": 3.0,
        "markets": 2.7,
        "china": 1.8,
        "accident": 1.6,
        "society": 1.0,
        "other": 0.3,
    }.get(theme, 0.3)
    return source_weight(item) + theme_bonus


def normalize_title(title: str) -> str:
    title = title.strip()
    if " - " in title:
        title = title.split(" - ")[0].strip()
    return title


def dedupe_titles(items: List[Dict]) -> List[Dict]:
    seen = set()
    out = []
    for item in items:
        key = normalize_title(item.get("title", "")).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def zh_theme_sentence(theme: str, items: List[Dict]) -> str:
    titles = [normalize_title(it.get("title", "")) for it in items[:2]]
    if theme == "geopolitics":
        return f"关键信号集中在中东局势，核心 headline 包括：{'; '.join(titles)}。说明市场仍把伊朗 / 战争升级视为第一主线。"
    if theme == "markets":
        return f"市场层面的核心线索是：{'; '.join(titles)}。整体指向风险偏好修复、油价回落与股市反弹。"
    if theme == "china":
        return f"中国相关报道主要体现为政策与官方口径：{'; '.join(titles)}。这类信息更多影响中期预期与叙事平衡。"
    if theme == "accident":
        return f"事故类消息中最显著的是：{'; '.join(titles)}。这类事件冲击短线情绪，但通常不是全球宏观主线。"
    if theme == "society":
        return f"社会 / 民生外溢层面的 headline 包括：{'; '.join(titles)}。它们提醒冲突影响正在向日常生活与社会治理扩散。"
    return f"其他值得关注的 headline 包括：{'; '.join(titles)}。"


def en_theme_sentence(theme: str, items: List[Dict]) -> str:
    titles = [normalize_title(it.get("title", "")) for it in items[:2]]
    if theme == "geopolitics":
        return f"The dominant signal remains geopolitical: {('; '.join(titles))}. This keeps Iran / regional escalation as the main global risk driver."
    if theme == "markets":
        return f"The market reaction is clear: {('; '.join(titles))}. The pattern points to falling oil, firmer equities, and a temporary risk-on rebound."
    if theme == "china":
        return f"China-related coverage is more about official signaling: {('; '.join(titles))}. These stories matter more for medium-term narrative and policy tone than for immediate market shock."
    if theme == "accident":
        return f"The main accident-related story is: {('; '.join(titles))}. It is important, but not the core macro theme of the last six hours."
    if theme == "society":
        return f"The social spillover angle shows up in: {('; '.join(titles))}. It suggests conflict and policy shocks are feeding into everyday conditions, not just headlines."
    return f"Other notable stories include: {('; '.join(titles))}."


def build_brief(items: List[Dict], excluded: List[Dict], max_themes: int) -> str:
    themed = defaultdict(list)
    for item in items:
        themed[classify_theme(item)].append(item)
    ranked_themes = sorted(
        [theme for theme in themed.keys() if theme != "other"],
        key=lambda theme: (len(themed[theme]), sum(score_item(it) for it in themed[theme])),
        reverse=True,
    )
    chosen_themes = ranked_themes[:max_themes] or ["other"]

    lines: List[str] = []
    lines.append("# 中文简报")
    lines.append("")
    lines.append("## 总览")
    lines.append(f"- 已过滤噪音后保留 {len(items)} 条新闻，剔除 {len(excluded)} 条低相关内容。")
    lines.append("- 当前主线仍是：中东风险、市场反应，以及政策口径的分化。")
    lines.append("")
    for idx, theme in enumerate(chosen_themes, start=1):
        zh_label = THEME_LABELS.get(theme, THEME_LABELS['other'])[0]
        lines.append(f"## 主线 {idx}：{zh_label}")
        lines.append(zh_theme_sentence(theme, themed[theme]))
        top_sources = ", ".join(dict.fromkeys([str(it.get('source', '')) for it in themed[theme][:3]]))
        if top_sources:
            lines.append(f"- 主要来源：{top_sources}")
        for item in themed[theme][:3]:
            lines.append(f"- {normalize_title(item.get('title',''))} [{item.get('source','')}]")
        lines.append("")

    lines.append("# English Brief")
    lines.append("")
    lines.append("## Overview")
    lines.append(f"- After filtering, {len(items)} stories remain and {len(excluded)} lower-signal items were removed.")
    lines.append("- The main themes are still Middle East risk, market repricing, and policy signaling divergence.")
    lines.append("")
    for idx, theme in enumerate(chosen_themes, start=1):
        en_label = THEME_LABELS.get(theme, THEME_LABELS['other'])[1]
        lines.append(f"## Theme {idx}: {en_label}")
        lines.append(en_theme_sentence(theme, themed[theme]))
        top_sources = ", ".join(dict.fromkeys([str(it.get('source', '')) for it in themed[theme][:3]]))
        if top_sources:
            lines.append(f"- Main sources: {top_sources}")
        for item in themed[theme][:3]:
            lines.append(f"- {normalize_title(item.get('title',''))} [{item.get('source','')}]")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def collect_queries(base_query: str, query_preset: str) -> List[str]:
    queries = [base_query]
    if query_preset == "global-brief":
        queries.extend(["Iran", "markets economy trade", "China policy economy"])
    elif query_preset == "china-brief":
        queries.extend(["China policy", "China economy trade"])
    elif query_preset == "tech-brief":
        queries.extend(["AI chips", "software regulation", "cloud startups"])
    out: List[str] = []
    seen = set()
    for q in queries:
        q = (q or "").strip()
        if not q or q in seen:
            continue
        seen.add(q)
        out.append(q)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate bilingual no-card global news brief")
    parser.add_argument("query", nargs="?", default="")
    parser.add_argument("--hours", type=int, default=6)
    parser.add_argument("--days", type=int, default=1)
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--per-source-limit", type=int, default=3)
    parser.add_argument("--source-preset", default="global")
    parser.add_argument("--sources")
    parser.add_argument("--use-feeds", action="store_true")
    parser.add_argument("--query-preset", default="global-brief")
    parser.add_argument("--hl", default="en-US")
    parser.add_argument("--gl", default="US")
    parser.add_argument("--ceid", default="US:en")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--max-themes", type=int, default=3)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    resolved_query = resolve_query(args.query, args.query_preset)
    queries = collect_queries(resolved_query, args.query_preset)
    sources = parse_sources_arg(args.sources, args.source_preset)

    all_items: List[Dict] = []
    for q in queries:
        all_items.extend(search_news(
            query=q,
            limit=max(1, min(args.limit, 20)),
            site=None,
            sources=sources,
            days=max(1, args.days),
            hours=max(0, args.hours),
            hl=args.hl,
            gl=args.gl,
            ceid=args.ceid,
            timeout=args.timeout,
            per_source_limit=max(1, min(args.per_source_limit, 10)),
            use_feeds=args.use_feeds,
        ))

    items = dedupe_titles(all_items)
    excluded = [it for it in items if is_noise(it)]
    kept = [it for it in items if not is_noise(it)]
    kept.sort(key=lambda it: (score_item(it), parse_published(it.get("published", ""))), reverse=True)

    if args.json:
        payload = {
            "queries": queries,
            "keptCount": len(kept),
            "excludedCount": len(excluded),
            "kept": kept,
            "excluded": excluded,
            "brief": build_brief(kept, excluded, args.max_themes),
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(build_brief(kept, excluded, args.max_themes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
