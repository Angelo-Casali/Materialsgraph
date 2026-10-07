"""Semantic Scholar connector -- thin adapter over enrichment/book_scout.py's fetch helpers.

Terms: non-commercial research use; we store only what we extract and cite by
paper id/DOI. Unauthenticated tier is shared and rate-limited, so keep the
1 s spacing book_scout already uses; SEMANTIC_SCHOLAR_API_KEY lifts it.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

from materialsgraph.enrichment.book_scout import _fetch_papers
from materialsgraph.harvest.connectors.base import RateLimiter
from materialsgraph.harvest.models import SourceRecord
from materialsgraph.harvest.normalize import normalize_doi, source_id_for


def to_source_record(item: dict) -> SourceRecord | None:
    title = item.get("title")
    if not title or not title.strip():
        return None
    ext = item.get("externalIds") or {}
    doi = normalize_doi(ext.get("DOI"))
    arxiv_id = ext.get("ArXiv")
    s2_id = item.get("paperId")
    sid = source_id_for(doi=doi, arxiv_id=arxiv_id, s2_id=s2_id)
    if not sid:
        return None
    return SourceRecord(
        source_id=sid,
        doi=doi,
        arxiv_id=arxiv_id,
        title=title.strip(),
        authors=[a.get("name") for a in item.get("authors") or [] if a.get("name")],
        year=item.get("year"),
        type="preprint" if (arxiv_id and not doi) else "paper",
        abstract=item.get("abstract"),
        url_or_doi=f"https://doi.org/{doi}" if doi else (item.get("url") or ""),
        provider="semantic_scholar",
        citation_count=item.get("citationCount"),
    )


class SemanticScholarConnector:
    name = "s2"

    def __init__(self):
        load_dotenv()
        self.api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
        self.limiter = RateLimiter(1.0)

    def search(self, query: str, *, since_year: int | None = None, limit: int = 20) -> list[SourceRecord]:
        self.limiter.wait()
        items = _fetch_papers(query, self.api_key)
        out = []
        for item in items:
            rec = to_source_record(item)
            if rec is None:
                continue
            if since_year and rec.year and rec.year < since_year:
                continue
            out.append(rec)
            if len(out) >= limit:
                break
        return out
