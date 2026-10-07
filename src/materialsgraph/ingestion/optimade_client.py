"""OPTIMADE connector (OQMD first; AFLOW, JARVIS, NOMAD, COD speak the same API).

Raw `requests` against the OPTIMADE v1 REST spec -- no extra dependency.
Writes data/raw/optimade_<provider>.json; schema_loader.load_external_records
does the resolve-then-attach into the graph.

Licensing: every provider states its own terms. /v1/info is recorded on the
run so the Source node carries whatever the provider says; unknown means
"do not redistribute", which only matters if this graph is ever published.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import requests

from materialsgraph import chem
from materialsgraph.ingestion.models import ExternalPropertyRecord

RAW_DIR = Path("data/raw")
USER_AGENT = "materialsgraph/0.1 (+https://github.com/angelo-casali/materialsgraph)"

PROVIDERS: dict[str, dict] = {
    "oqmd": {
        "base_url": "https://oqmd.org/optimade/v1",
        "page_limit": 50,
        # OPTIMADE provider-specific fields -> canonical PropertyType names
        "fields": {
            "_oqmd_delta_e": "formation_energy",
            "_oqmd_band_gap": "band_gap",
            "_oqmd_stability": "energy_above_hull",
        },
        "license": "see https://oqmd.org/documentation (academic use; cite Saal et al. 2013, Kirklin et al. 2015)",
    },
    "jarvis": {
        "base_url": "https://jarvis.nist.gov/optimade/jarvisdft/v1",
        "page_limit": 50,
        "fields": {
            "_jarvis_formation_energy_peratom": "formation_energy",
            "_jarvis_optb88vdw_bandgap": "band_gap",
            "_jarvis_ehull": "energy_above_hull",
        },
        "license": "NIST public data (see https://jarvis.nist.gov)",
    },
    # Structure-only providers (coverage, no scalar properties through OPTIMADE):
    "aflow": {"base_url": "https://aflow.org/API/optimade/v1", "page_limit": 50, "fields": {}, "license": "see https://aflow.org"},
    "nomad": {"base_url": "https://nomad-lab.eu/prod/rae/optimade/v1", "page_limit": 50, "fields": {}, "license": "CC-BY-4.0 (NOMAD)"},
}

DEFAULT_FILTER = 'elements HAS ALL "Li","O" AND nelements<=4'


class OptimadeClient:
    def __init__(self, provider: str, *, min_interval_s: float = 1.0, timeout: int = 30, session: requests.Session | None = None):
        if provider not in PROVIDERS:
            raise ValueError(f"unknown provider {provider!r}; choose from {sorted(PROVIDERS)}")
        self.provider = provider
        self.spec = PROVIDERS[provider]
        self.min_interval_s = min_interval_s
        self.timeout = timeout
        self.http = session or requests.Session()
        self.http.headers.update({"User-Agent": USER_AGENT, "Accept": "application/vnd.api+json, application/json"})
        self._last = 0.0

    def _get(self, url: str, params: dict | None = None) -> dict:
        wait = self.min_interval_s - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        for attempt in range(4):
            resp = self.http.get(url, params=params, timeout=self.timeout)
            self._last = time.monotonic()
            if resp.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()
        return {}

    def info(self) -> dict:
        try:
            return self._get(f"{self.spec['base_url']}/info")
        except requests.RequestException as exc:
            print(f"[{self.provider}] /info failed: {exc}")
            return {}

    def fetch_structures(self, filter_str: str, *, max_pages: int = 5) -> list[dict]:
        fields = ",".join(["chemical_formula_reduced", "chemical_formula_descriptive", "elements", "nelements", "nsites", "species_at_sites", "last_modified", *self.spec["fields"].keys()])
        url = f"{self.spec['base_url']}/structures"
        params: dict | None = {"filter": filter_str, "page_limit": self.spec["page_limit"], "response_fields": fields}
        out: list[dict] = []
        for _ in range(max_pages):
            try:
                payload = self._get(url, params)
            except requests.RequestException as exc:
                print(f"[{self.provider}] request failed: {exc}")
                break
            out.extend(payload.get("data", []) or [])
            next_link = (payload.get("links") or {}).get("next")
            if not next_link:
                break
            url = next_link["href"] if isinstance(next_link, dict) else next_link
            params = None
        return out


def _spacegroup_number(attrs: dict) -> int | None:
    for key in ("_oqmd_spacegroup_number", "_jarvis_spg_number", "space_group_it_number"):
        v = attrs.get(key)
        if isinstance(v, int):
            return v
    return None


def to_external_records(provider: str, docs: list[dict], license_text: str | None) -> list[ExternalPropertyRecord]:
    spec = PROVIDERS[provider]
    out: list[ExternalPropertyRecord] = []
    for doc in docs:
        attrs = doc.get("attributes", {}) or {}
        formula = attrs.get("chemical_formula_reduced") or attrs.get("chemical_formula_descriptive")
        if not formula:
            continue
        try:
            reduced = chem.reduced_formula(formula)
            composition = chem.parse_composition(formula)
        except chem.FormulaError:
            continue
        props: dict[str, float] = {}
        for src_field, canonical in spec["fields"].items():
            v = attrs.get(src_field)
            if isinstance(v, (int, float)):
                props[canonical] = float(v)
        out.append(
            ExternalPropertyRecord(
                provider=provider,
                provider_id=str(doc.get("id")),
                formula=formula,
                reduced_formula=reduced,
                spacegroup_number=_spacegroup_number(attrs),
                composition=composition,
                properties=props,
                license=license_text,
                url=f"{spec['base_url']}/structures/{doc.get('id')}",
            )
        )
    return out


def output_path(provider: str) -> Path:
    return RAW_DIR / f"optimade_{provider}.json"


def pull(provider: str, filter_str: str, max_pages: int) -> Path:
    client = OptimadeClient(provider)
    info = client.info()
    provider_meta = ((info.get("meta") or {}).get("provider") or {})
    license_text = PROVIDERS[provider].get("license") or provider_meta.get("description")
    docs = client.fetch_structures(filter_str, max_pages=max_pages)
    print(f"[{provider}] fetched {len(docs)} structures")
    records = to_external_records(provider, docs, license_text)
    path = output_path(provider)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"provider": provider, "filter": filter_str, "info": info.get("meta", {}), "records": [r.model_dump() for r in records]}, indent=2))
    print(f"[{provider}] saved {len(records)} records to {path}")
    return path


def load_saved(provider: str) -> list[ExternalPropertyRecord]:
    payload = json.loads(output_path(provider).read_text())
    return [ExternalPropertyRecord(**r) for r in payload["records"]]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Pull structures/properties from an OPTIMADE provider")
    parser.add_argument("--provider", default="oqmd", choices=sorted(PROVIDERS))
    parser.add_argument("--filter", default=DEFAULT_FILTER)
    parser.add_argument("--max-pages", type=int, default=5)
    args = parser.parse_args(argv)
    pull(args.provider, args.filter, args.max_pages)


if __name__ == "__main__":
    main()
