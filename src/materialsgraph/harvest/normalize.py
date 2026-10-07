"""Source-record normalisation shared by all literature connectors."""

from __future__ import annotations

import re

from materialsgraph.harvest.models import SourceRecord, normalize_ws

_DOI_RE = re.compile(r"(10\.\d{4,9}/[^\s\"<>]+)", re.IGNORECASE)
_YEAR_RE = re.compile(r"(\d{4})")


def normalize_doi(value: str | None) -> str | None:
    """'https://doi.org/10.1088/ABC' -> '10.1088/abc'. None when no DOI is present."""
    if not value:
        return None
    m = _DOI_RE.search(value)
    if not m:
        return None
    return m.group(1).rstrip(".,;)").lower()


def source_id_for(*, doi: str | None, openalex_id: str | None = None, arxiv_id: str | None = None, s2_id: str | None = None) -> str | None:
    if doi:
        return f"doi:{doi}"
    if arxiv_id:
        return f"arxiv:{arxiv_id}"
    if openalex_id:
        return f"openalex:{openalex_id}"
    if s2_id:
        return f"s2:{s2_id}"
    return None


def year_from(text: str | None) -> int | None:
    """'2025', '2025-07', '2025-07-05' -> 2025."""
    if not text:
        return None
    m = _YEAR_RE.match(str(text))
    return int(m.group(1)) if m else None


def dedupe_sources(records: list[SourceRecord]) -> list[SourceRecord]:
    """De-dupe by DOI first, then by normalised title; keeps the record with the longest abstract."""
    by_key: dict[str, SourceRecord] = {}
    for rec in records:
        key = f"doi:{rec.doi}" if rec.doi else f"title:{normalize_ws(rec.title)}"
        existing = by_key.get(key)
        if existing is None or len(rec.abstract or "") > len(existing.abstract or ""):
            if existing is not None:
                # merge identifiers so nothing is lost
                rec.openalex_id = rec.openalex_id or existing.openalex_id
                rec.arxiv_id = rec.arxiv_id or existing.arxiv_id
                rec.license = rec.license or existing.license
                rec.oa_pdf_url = rec.oa_pdf_url or existing.oa_pdf_url
            by_key[key] = rec
    return list(by_key.values())


def recent_first(records: list[SourceRecord]) -> list[SourceRecord]:
    return sorted(records, key=lambda r: (r.year or 0, r.citation_count or 0), reverse=True)
