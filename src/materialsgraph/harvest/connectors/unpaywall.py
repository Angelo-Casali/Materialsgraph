"""Unpaywall: find a legal open-access copy (and its license) for a DOI. Needs UNPAYWALL_EMAIL."""

from __future__ import annotations

import os

import requests
from dotenv import load_dotenv

from materialsgraph.harvest.connectors.base import RateLimiter, get_json
from materialsgraph.harvest.models import SourceRecord

BASE = "https://api.unpaywall.org/v2"


class UnpaywallConnector:
    name = "unpaywall"

    def __init__(self, http: requests.Session | None = None):
        load_dotenv()
        self.email = os.environ.get("UNPAYWALL_EMAIL") or os.environ.get("OPENALEX_MAILTO")
        self.http = http or requests.Session()
        self.limiter = RateLimiter(0.2)

    def oa_location(self, doi: str) -> dict | None:
        """{'pdf_url', 'license', 'host_type', 'is_oa'} or None."""
        if not self.email:
            print("UNPAYWALL_EMAIL not set; skipping Unpaywall")
            return None
        payload = get_json(self.http, f"{BASE}/{doi}", params={"email": self.email}, limiter=self.limiter)
        if not payload:
            return None
        best = payload.get("best_oa_location") or {}
        return {
            "is_oa": payload.get("is_oa"),
            "pdf_url": best.get("url_for_pdf") or best.get("url"),
            "license": best.get("license"),
            "host_type": best.get("host_type"),
        }

    def enrich(self, record: SourceRecord) -> SourceRecord:
        if not record.doi or (record.oa_pdf_url and record.license):
            return record
        loc = self.oa_location(record.doi)
        if loc:
            record.is_oa = loc["is_oa"] if record.is_oa is None else record.is_oa
            record.oa_pdf_url = record.oa_pdf_url or loc["pdf_url"]
            record.license = record.license or loc["license"]
        return record
