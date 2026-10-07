"""PubChem PUG-REST lookups for molecular electrolyte species (identifiers only).

Public-domain data, <= 5 requests/s. Used to fill/refresh InChIKey, SMILES,
CID and molecular weight for the hand-entered harvest/aliases.MOLECULE_ALIASES
table and for molecules the harvester meets in the literature.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import requests

from materialsgraph.graph.reference import PUBCHEM_SOURCE_ID
from materialsgraph.harvest.aliases import MOLECULE_ALIASES
from materialsgraph.ingestion.models import MoleculeRecord

BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
RAW_PATH = Path("data/raw/molecules.json")
PROPS = "MolecularFormula,MolecularWeight,InChIKey,CanonicalSMILES,IsomericSMILES,Title"
MIN_INTERVAL_S = 0.25


class PubChemClient:
    def __init__(self, session: requests.Session | None = None, timeout: int = 20):
        self.http = session or requests.Session()
        self.http.headers.update({"User-Agent": "materialsgraph/0.1"})
        self.timeout = timeout
        self._last = 0.0

    def _get(self, url: str) -> dict | None:
        wait = MIN_INTERVAL_S - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        try:
            resp = self.http.get(url, timeout=self.timeout)
            self._last = time.monotonic()
            if resp.status_code == 404:
                return None
            if resp.status_code == 503:
                time.sleep(2)
                resp = self.http.get(url, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            print(f"PubChem request failed: {exc}")
            return None

    def lookup(self, name_or_inchikey: str) -> dict | None:
        """Return {cid, formula, molecular_weight, inchikey, smiles, title} or None."""
        if len(name_or_inchikey) == 27 and name_or_inchikey.count("-") == 2:
            url = f"{BASE}/compound/inchikey/{name_or_inchikey}/property/{PROPS}/JSON"
        else:
            url = f"{BASE}/compound/name/{requests.utils.quote(name_or_inchikey)}/property/{PROPS}/JSON"
        payload = self._get(url)
        if not payload:
            return None
        props = (payload.get("PropertyTable") or {}).get("Properties") or []
        if not props:
            return None
        p = props[0]
        return {
            "cid": p.get("CID"),
            "formula": p.get("MolecularFormula"),
            "molecular_weight": float(p["MolecularWeight"]) if p.get("MolecularWeight") else None,
            "inchikey": p.get("InChIKey"),
            "smiles": p.get("IsomericSMILES") or p.get("CanonicalSMILES"),
            "title": p.get("Title"),
        }


def molecule_records(client: PubChemClient | None = None, *, refresh: bool = True) -> list[MoleculeRecord]:
    """Alias table -> MoleculeRecords, refreshed from PubChem when reachable."""
    client = client or PubChemClient()
    out: list[MoleculeRecord] = []
    for key, spec in MOLECULE_ALIASES.items():
        data = None
        if refresh:
            query = spec.get("inchikey") or spec.get("aliases", [spec["common_name"]])[0]
            data = client.lookup(query)
        inchikey = (data or {}).get("inchikey") or spec.get("inchikey")
        if not inchikey:
            # polymers and a few salts have no single PubChem entry; keep a name-based key
            inchikey = f"name:{spec['common_name'].lower()}"
        out.append(
            MoleculeRecord(
                common_name=spec["common_name"],
                formula=(data or {}).get("formula") or spec["formula"],
                inchikey=inchikey,
                smiles=(data or {}).get("smiles") or spec.get("smiles"),
                cid=(data or {}).get("cid"),
                molecular_weight=(data or {}).get("molecular_weight"),
                roles=spec.get("roles", []),
                aliases=[key, *spec.get("aliases", [])],
            )
        )
    return out


def pull(refresh: bool = True) -> Path:
    records = molecule_records(refresh=refresh)
    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    RAW_PATH.write_text(json.dumps({"source": PUBCHEM_SOURCE_ID, "records": [r.model_dump() for r in records]}, indent=2))
    print(f"Saved {len(records)} molecules to {RAW_PATH}")
    return RAW_PATH


def load_saved() -> list[MoleculeRecord]:
    return [MoleculeRecord(**r) for r in json.loads(RAW_PATH.read_text())["records"]]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Build the molecule table (PubChem identifiers)")
    parser.add_argument("--offline", action="store_true", help="use the hand-entered alias table without calling PubChem")
    args = parser.parse_args(argv)
    pull(refresh=not args.offline)


if __name__ == "__main__":
    main()
