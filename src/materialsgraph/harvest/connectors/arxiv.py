"""arXiv Atom API connector (cond-mat.mtrl-sci etc.). 1 request / 3 s per arXiv's terms."""

from __future__ import annotations

import re
import time
import xml.etree.ElementTree as ET

import requests

from materialsgraph.harvest.connectors.base import polite_headers
from materialsgraph.harvest.models import SourceRecord
from materialsgraph.harvest.normalize import normalize_doi

BASE = "https://export.arxiv.org/api/query"
NS = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


def parse_feed(xml_text: str) -> list[SourceRecord]:
    root = ET.fromstring(xml_text)
    out: list[SourceRecord] = []
    for entry in root.findall("a:entry", NS):
        raw_id = (entry.findtext("a:id", default="", namespaces=NS) or "").rsplit("/abs/", 1)[-1]
        arxiv_id = re.sub(r"v\d+$", "", raw_id)
        title = re.sub(r"\s+", " ", entry.findtext("a:title", default="", namespaces=NS) or "").strip()
        if not arxiv_id or not title:
            continue
        doi = normalize_doi(entry.findtext("arxiv:doi", default=None, namespaces=NS))
        published = entry.findtext("a:published", default="", namespaces=NS) or ""
        pdf_url = None
        for link in entry.findall("a:link", NS):
            if link.get("title") == "pdf":
                pdf_url = link.get("href")
        out.append(
            SourceRecord(
                source_id=f"doi:{doi}" if doi else f"arxiv:{arxiv_id}",
                doi=doi,
                arxiv_id=arxiv_id,
                title=title,
                authors=[a.findtext("a:name", default="", namespaces=NS) for a in entry.findall("a:author", NS)],
                year=int(published[:4]) if published[:4].isdigit() else None,
                type="preprint",
                abstract=re.sub(r"\s+", " ", entry.findtext("a:summary", default="", namespaces=NS) or "").strip() or None,
                url_or_doi=f"https://arxiv.org/abs/{arxiv_id}",
                license=None,  # per-paper; arXiv default licence does not permit redistribution
                is_oa=True,
                oa_pdf_url=pdf_url,
                provider="arxiv",
            )
        )
    return out


class ArxivConnector:
    name = "arxiv"

    def __init__(self, http: requests.Session | None = None, category: str = "cond-mat.mtrl-sci"):
        self.http = http or requests.Session()
        self.category = category
        self._last = 0.0

    def search(self, query: str, *, since_year: int | None = None, limit: int = 50) -> list[SourceRecord]:
        wait = 3.0 - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        q = f"all:{query}"
        if self.category:
            q = f"({q}) AND cat:{self.category}"
        try:
            resp = self.http.get(
                BASE,
                params={"search_query": q, "max_results": min(limit, 200), "sortBy": "submittedDate", "sortOrder": "descending"},
                headers=polite_headers(),
                timeout=30,
            )
            self._last = time.monotonic()
            resp.raise_for_status()
        except requests.RequestException as exc:
            print(f"arXiv search failed: {exc}")
            return []
        records = parse_feed(resp.text)
        if since_year:
            records = [r for r in records if r.year is None or r.year >= since_year]
        return records[:limit]
