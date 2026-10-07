"""Shared plumbing for literature connectors: protocol, rate limiting, polite headers."""

from __future__ import annotations

import os
import time
from typing import Protocol

import requests
from dotenv import load_dotenv

from materialsgraph.harvest.models import SourceRecord

USER_AGENT = "materialsgraph/0.1 (+https://github.com/angelo-casali/materialsgraph)"
OPEN_LICENSES = {"cc-by", "cc-by-4.0", "cc-by-sa", "cc-by-sa-4.0", "cc0", "public-domain", "cc-by-nc", "cc-by-nc-4.0", "cc-by-nc-nd", "cc-by-nc-sa"}
# Only these allow storing text chunks in the graph. NC variants are allowed
# because this is a personal, non-commercial project; drop them if the graph
# is ever published commercially.


def mailto() -> str | None:
    load_dotenv()
    return os.environ.get("OPENALEX_MAILTO") or os.environ.get("UNPAYWALL_EMAIL")


def polite_headers() -> dict[str, str]:
    ua = USER_AGENT
    m = mailto()
    if m:
        ua += f" mailto:{m}"
    return {"User-Agent": ua, "Accept": "application/json"}


class RateLimiter:
    def __init__(self, min_interval_s: float):
        self.min_interval_s = min_interval_s
        self._last = 0.0

    def wait(self) -> None:
        delta = self.min_interval_s - (time.monotonic() - self._last)
        if delta > 0:
            time.sleep(delta)
        self._last = time.monotonic()


def get_json(http: requests.Session, url: str, *, params: dict | None = None, headers: dict | None = None, limiter: RateLimiter | None = None, timeout: int = 20, retries: int = 3) -> dict | None:
    for attempt in range(retries + 1):
        if limiter:
            limiter.wait()
        try:
            resp = http.get(url, params=params, headers=headers or polite_headers(), timeout=timeout)
        except requests.RequestException as exc:
            if attempt >= retries:
                print(f"GET {url} failed: {exc}")
                return None
            time.sleep(2 ** attempt)
            continue
        if resp.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 ** attempt)
            continue
        if resp.status_code == 404:
            return None
        if not resp.ok:
            print(f"GET {url} -> HTTP {resp.status_code}")
            return None
        try:
            return resp.json()
        except ValueError:
            return None
    return None


def is_open_license(license_text: str | None) -> bool:
    if not license_text:
        return False
    return license_text.strip().lower() in OPEN_LICENSES or license_text.strip().lower().startswith("cc-")


class LiteratureConnector(Protocol):
    name: str

    def search(self, query: str, *, since_year: int | None = None, limit: int = 50) -> list[SourceRecord]: ...
