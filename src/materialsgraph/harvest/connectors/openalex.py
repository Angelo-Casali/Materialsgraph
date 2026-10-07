"""OpenAlex works search: free, no key, CC0 metadata, abstracts for most works.

Polite pool: pass mailto= (OPENALEX_MAILTO in .env). ~10 req/s allowed; we
use 0.2 s spacing and cursor paging.
"""

from __future__ import annotations

import requests

from materialsgraph.harvest.connectors.base import RateLimiter, get_json, mailto
from materialsgraph.harvest.models import SourceRecord
from materialsgraph.harvest.normalize import normalize_doi, source_id_for

BASE = "https://api.openalex.org/works"
FIELDS = "id,doi,title,display_name,publication_year,type,authorships,abstract_inverted_index,open_access,best_oa_location,primary_location,cited_by_count,ids"


def reconstruct_abstract(inverted: dict | None) -> str | None:
    if not inverted:
        return None
    positions: list[tuple[int, str]] = []
    for word, idxs in inverted.items():
        for i in idxs:
            positions.append((i, word))
    positions.sort()
    return " ".join(w for _, w in positions) or None


def to_source_record(work: dict) -> SourceRecord | None:
    title = work.get("title") or work.get("display_name")
    if not title:
        return None
    doi = normalize_doi(work.get("doi"))
    openalex_id = (work.get("id") or "").rsplit("/", 1)[-1] or None
    arxiv_id = None
    oa = work.get("open_access") or {}
    best = work.get("best_oa_location") or {}
    primary = work.get("primary_location") or {}
    license_ = best.get("license") or primary.get("license")
    pdf_url = best.get("pdf_url") or oa.get("oa_url")
    if pdf_url and "arxiv.org" in pdf_url:
        arxiv_id = pdf_url.rsplit("/", 1)[-1].replace(".pdf", "")
    sid = source_id_for(doi=doi, openalex_id=openalex_id, arxiv_id=arxiv_id)
    if not sid:
        return None
    wtype = (work.get("type") or "").lower()
    stype = "preprint" if wtype == "preprint" or (arxiv_id and not doi) else "paper"
    if wtype in ("book", "book-chapter", "monograph"):
        stype = "book"
    venue = ((primary.get("source") or {}).get("display_name")) if primary else None
    return SourceRecord(
        source_id=sid,
        doi=doi,
        openalex_id=openalex_id,
        arxiv_id=arxiv_id,
        title=title.strip(),
        authors=[(a.get("author") or {}).get("display_name") for a in work.get("authorships") or [] if (a.get("author") or {}).get("display_name")],
        year=work.get("publication_year"),
        type=stype,
        abstract=reconstruct_abstract(work.get("abstract_inverted_index")),
        url_or_doi=f"https://doi.org/{doi}" if doi else (work.get("id") or ""),
        license=license_,
        is_oa=oa.get("is_oa"),
        oa_pdf_url=pdf_url,
        provider="openalex",
        citation_count=work.get("cited_by_count"),
        venue=venue,
    )


class OpenAlexConnector:
    name = "openalex"

    def __init__(self, http: requests.Session | None = None, per_page: int = 50):
        self.http = http or requests.Session()
        self.per_page = min(per_page, 200)
        self.limiter = RateLimiter(0.2)

    def search(self, query: str, *, since_year: int | None = None, limit: int = 50) -> list[SourceRecord]:
        filters = ["has_abstract:true"]
        if since_year:
            filters.append(f"from_publication_date:{since_year}-01-01")
        params = {
            "search": query,
            "filter": ",".join(filters),
            "per-page": min(self.per_page, limit),
            "select": FIELDS,
            "cursor": "*",
            "sort": "relevance_score:desc",
        }
        m = mailto()
        if m:
            params["mailto"] = m
        out: list[SourceRecord] = []
        while len(out) < limit:
            payload = get_json(self.http, BASE, params=params, limiter=self.limiter)
            if not payload:
                break
            for work in payload.get("results", []):
                rec = to_source_record(work)
                if rec:
                    out.append(rec)
                if len(out) >= limit:
                    break
            cursor = (payload.get("meta") or {}).get("next_cursor")
            if not cursor:
                break
            params["cursor"] = cursor
        return out
