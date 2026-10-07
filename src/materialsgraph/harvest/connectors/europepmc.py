"""Europe PMC: open-access full text (XML) for papers in its OA subset. Thin battery coverage; optional."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import requests

from materialsgraph.harvest.connectors.base import RateLimiter, get_json, polite_headers

SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
FULLTEXT = "https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML"


class EuropePMCConnector:
    name = "europepmc"

    def __init__(self, http: requests.Session | None = None):
        self.http = http or requests.Session()
        self.limiter = RateLimiter(0.5)

    def pmcid_for_doi(self, doi: str) -> tuple[str | None, str | None]:
        payload = get_json(self.http, SEARCH, params={"query": f'DOI:"{doi}" AND OPEN_ACCESS:y', "format": "json", "resultType": "lite"}, limiter=self.limiter)
        hits = ((payload or {}).get("resultList") or {}).get("result") or []
        if not hits:
            return None, None
        hit = hits[0]
        return hit.get("pmcid"), hit.get("license")

    def full_text(self, pmcid: str) -> list[tuple[str, str]] | None:
        """Return [(section_title, text)] from the JATS XML, or None."""
        self.limiter.wait()
        try:
            resp = self.http.get(FULLTEXT.format(pmcid=pmcid), headers=polite_headers(), timeout=30)
            if not resp.ok:
                return None
            root = ET.fromstring(resp.text)
        except (requests.RequestException, ET.ParseError):
            return None
        sections: list[tuple[str, str]] = []
        for sec in root.iter("sec"):
            title = (sec.findtext("title") or "").strip() or "body"
            text = " ".join(" ".join(p.itertext()) for p in sec.findall("p"))
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                sections.append((title, text))
        return sections or None
