"""CrossRef: DOI metadata completion only (title, year, authors, license when deposited)."""

from __future__ import annotations

import requests

from materialsgraph.harvest.connectors.base import RateLimiter, get_json, mailto
from materialsgraph.harvest.models import SourceRecord

BASE = "https://api.crossref.org/works"


class CrossRefConnector:
    name = "crossref"

    def __init__(self, http: requests.Session | None = None):
        self.http = http or requests.Session()
        self.limiter = RateLimiter(0.5)

    def fill_missing_metadata(self, record: SourceRecord) -> SourceRecord:
        if not record.doi:
            return record
        params = {}
        m = mailto()
        if m:
            params["mailto"] = m
        payload = get_json(self.http, f"{BASE}/{record.doi}", params=params, limiter=self.limiter)
        msg = (payload or {}).get("message") or {}
        if not msg:
            return record
        if not record.year:
            parts = (msg.get("issued") or {}).get("date-parts") or [[None]]
            record.year = parts[0][0] if parts and parts[0] else None
        if not record.authors:
            record.authors = [" ".join(p for p in (a.get("given"), a.get("family")) if p) for a in msg.get("author") or []]
        if not record.license:
            lic = (msg.get("license") or [{}])[0].get("URL")
            if lic and "creativecommons.org" in lic:
                record.license = "cc-" + lic.rstrip("/").split("/licenses/")[-1].split("/")[0] if "/licenses/" in lic else lic
        if not record.abstract and msg.get("abstract"):
            import re

            record.abstract = re.sub(r"<[^>]+>", "", msg["abstract"]).strip()
        if not record.venue:
            ct = msg.get("container-title") or []
            record.venue = ct[0] if ct else None
        return record
