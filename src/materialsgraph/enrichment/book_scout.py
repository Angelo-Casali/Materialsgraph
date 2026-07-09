"""Literature/book discovery, recency-ranked.

Discovery only: this does not write to Neo4j and does not call any LLM.
relevance_note is left null on every record -- filling it in is a future
LLM-annotation step, not this tool's job.
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

SEMANTIC_SCHOLAR_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
GOOGLE_BOOKS_SEARCH_URL = "https://www.googleapis.com/books/v1/volumes"

PAPER_FIELDS = "title,year,authors,abstract,citationCount,externalIds,url"
PAPER_LIMIT = 20
BOOK_MAX_RESULTS = 20
SNIPPET_MAX_LEN = 200

DEFAULT_KEYWORDS = [
    "battery materials",
    "lithium-ion battery cathode",
    "solid-state battery electrolyte",
]

OUTPUT_PATH = Path("data/literature/battery_scout_results.json")

YEAR_RE = re.compile(r"(\d{4})")


def _truncate(text: str | None, length: int = SNIPPET_MAX_LEN) -> str | None:
    if not text:
        return None
    text = text.strip()
    return text if len(text) <= length else text[:length].rstrip() + "..."


def _parse_leading_year(published_date: str | None) -> int | None:
    """publishedDate can be '2025', '2025-07', or '2025-07-05' -- take the leading year."""
    if not published_date:
        return None
    match = YEAR_RE.match(published_date)
    return int(match.group(1)) if match else None


def _fetch_papers(keyword: str, api_key: str | None) -> list[dict]:
    headers = {"x-api-key": api_key} if api_key else {}
    params = {"query": keyword, "fields": PAPER_FIELDS, "limit": PAPER_LIMIT}
    try:
        response = requests.get(SEMANTIC_SCHOLAR_SEARCH_URL, params=params, headers=headers, timeout=15)
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"Semantic Scholar search failed for '{keyword}': {exc}")
        return []
    return response.json().get("data", []) or []


def _fetch_books(keyword: str) -> list[dict]:
    params = {"q": keyword, "maxResults": BOOK_MAX_RESULTS}
    try:
        response = requests.get(GOOGLE_BOOKS_SEARCH_URL, params=params, timeout=15)
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"Google Books search failed for '{keyword}': {exc}")
        return []
    return response.json().get("items", []) or []


def _normalize_paper(item: dict) -> dict | None:
    title = item.get("title")
    if not title or not title.strip():
        return None
    return {
        "title": title.strip(),
        "authors": [a.get("name") for a in item.get("authors") or [] if a.get("name")],
        "year": item.get("year"),
        "type": "paper",
        "link": item.get("url"),
        "citation_count": item.get("citationCount"),
        "snippet": _truncate(item.get("abstract")),
        "relevance_note": None,
    }


def _normalize_book(item: dict) -> dict | None:
    info = item.get("volumeInfo", {})
    title = info.get("title")
    if not title or not title.strip():
        return None
    return {
        "title": title.strip(),
        "authors": info.get("authors") or [],
        "year": _parse_leading_year(info.get("publishedDate")),
        "type": "book",
        "link": info.get("previewLink"),
        "citation_count": None,
        "snippet": _truncate(info.get("description")),
        "relevance_note": None,
    }


def _dedupe_by_title(records: list[dict]) -> list[dict]:
    """De-dupe within one source type by normalized (lowercased, stripped) title."""
    seen: set[str] = set()
    deduped = []
    for record in records:
        key = record["title"].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    return deduped


def _cutoff_year(recent_months: int) -> int:
    """Approximate month->day conversion: Semantic Scholar only gives a year for
    papers (no publication month), so bucketing can't be more precise than year
    granularity anyway."""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=recent_months * 30)
    return cutoff_date.year


def _foundational_sort_key(record: dict) -> tuple[bool, float, int]:
    """citationCount when available (papers), ranked above records without one
    (books); within either group, ties break on year descending. Comparing raw
    citation counts against raw years on one numeric scale would be meaningless
    (a 1998 book would outrank a 900-citation paper), so citation-having and
    citation-lacking records are ranked as two separate tiers instead."""
    has_citations = record["citation_count"] is not None
    return (has_citations, record["citation_count"] or 0, record["year"] or 0)


def _bucket_and_sort(records: list[dict], recent_months: int) -> tuple[list[dict], list[dict]]:
    cutoff_year = _cutoff_year(recent_months)
    recent, foundational = [], []
    for record in records:
        # No parseable year -> can't confirm recency, so default to foundational.
        if record["year"] is not None and record["year"] >= cutoff_year:
            recent.append(record)
        else:
            foundational.append(record)

    recent.sort(key=lambda r: r["year"], reverse=True)
    foundational.sort(key=_foundational_sort_key, reverse=True)
    return recent, foundational


def scout(keywords: list[str] | None = None, recent_months: int = 18) -> dict:
    load_dotenv()
    api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
    keywords = keywords or DEFAULT_KEYWORDS

    paper_records, book_records = [], []
    for keyword in keywords:
        for item in _fetch_papers(keyword, api_key):
            record = _normalize_paper(item)
            if record:
                paper_records.append(record)
        time.sleep(1)  # unauthenticated Semantic Scholar tier rate-limits aggressively

        for item in _fetch_books(keyword):
            record = _normalize_book(item)
            if record:
                book_records.append(record)

    paper_records = _dedupe_by_title(paper_records)
    book_records = _dedupe_by_title(book_records)

    recent, foundational = _bucket_and_sort(paper_records + book_records, recent_months)
    result = {"recent": recent, "foundational": foundational}

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    results = scout()
    for section in ("recent", "foundational"):
        records = results[section]
        print(f"\n--- {section} ({len(records)}) ---")
        for record in records:
            print(f"[{record['type']}] {record['year']} - {record['title']}")
            print(f"    {record['link']}")
