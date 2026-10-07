"""Liverpool Ionics Dataset: experimentally measured Li-ion conductivities of solid electrolytes.

Hargreaves, C.J. et al., "A database of experimentally measured lithium solid
electrolyte conductivities evaluated with machine learning", npj Comput. Mater.
9, 9 (2023). Data repository: https://github.com/lrcfmd/LiIonDatabase

This is the single highest-value structured source for the headline
`ionic_conductivity` gap: a few hundred *measured* room-temperature values with
a DOI per entry. The loader is column-name tolerant because the CSV layout has
changed between releases; adjust COLUMN_CANDIDATES if a column is not found.

License: the repository states its own terms; `pull()` records whatever
LICENSE file it finds so the Source node is honest about it.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
from pathlib import Path

import requests

from materialsgraph.graph.reference import LIVERPOOL_SOURCE_ID
from materialsgraph.harvest.normalize import normalize_doi, year_from
from materialsgraph.ingestion.models import MeasuredPropertyRecord

RAW_PATH = Path("data/raw/liverpool_ionics.json")
# The repository layout has moved between releases; every plausible raw path is
# tried in order, and `--csv <file>` always works for a manual download.
_REPO = "https://raw.githubusercontent.com/lrcfmd/LiIonDatabase"
DEFAULT_CSV_URLS = [
    f"{_REPO}/{branch}/{name}"
    for branch in ("main", "master")
    for name in ("LiIonDatabase.csv", "data/LiIonDatabase.csv", "database/LiIonDatabase.csv", "LiIonDatabase_v1.csv")
]
LICENSE_URLS = [f"{_REPO}/{branch}/{name}" for branch in ("main", "master") for name in ("LICENSE", "LICENSE.md", "LICENSE.txt")]

COLUMN_CANDIDATES = {
    "formula": ["composition", "Composition", "formula", "Formula", "Reduced Composition"],
    "conductivity": ["conductivity", "Ionic conductivity (S cm-1)", "sigma", "Conductivity (S/cm)", "Ionic Conductivity", "RT conductivity"],
    "log_conductivity": ["log_conductivity", "log10(sigma)", "log_sigma", "Log Conductivity"],
    "temperature": ["temperature", "Temperature (K)", "T (K)", "Temp", "T"],
    "doi": ["doi", "DOI", "Reference DOI", "reference"],
    "year": ["year", "Year"],
    "title": ["title", "Title"],
}


def _pick(row: dict, names: list[str]) -> str | None:
    for n in names:
        if n in row and row[n] not in (None, ""):
            return str(row[n]).strip()
    return None


def _float(text: str | None) -> float | None:
    if text is None:
        return None
    try:
        return float(text.replace("−", "-"))
    except ValueError:
        return None


def parse_csv(text: str) -> list[MeasuredPropertyRecord]:
    reader = csv.DictReader(io.StringIO(text))
    out: list[MeasuredPropertyRecord] = []
    for row in reader:
        formula = _pick(row, COLUMN_CANDIDATES["formula"])
        if not formula:
            continue
        sigma = _float(_pick(row, COLUMN_CANDIDATES["conductivity"]))
        if sigma is None:
            log_sigma = _float(_pick(row, COLUMN_CANDIDATES["log_conductivity"]))
            sigma = 10 ** log_sigma if log_sigma is not None else None
        if sigma is None or sigma <= 0:
            continue
        temperature = _float(_pick(row, COLUMN_CANDIDATES["temperature"]))
        doi = normalize_doi(_pick(row, COLUMN_CANDIDATES["doi"]))
        conditions = {"temperature_K": temperature} if temperature else {"temperature_K": 298.0, "assumed": "room temperature"}
        out.append(
            MeasuredPropertyRecord(
                formula_raw=formula,
                property_type="ionic_conductivity",
                value=sigma,
                unit="S/cm",
                conditions=conditions,
                doi=doi,
                source_id=f"doi:{doi}" if doi else LIVERPOOL_SOURCE_ID,
                title=_pick(row, COLUMN_CANDIDATES["title"]),
                year=year_from(_pick(row, COLUMN_CANDIDATES["year"])),
                dataset_source_id=LIVERPOOL_SOURCE_ID,
            )
        )
    return out


def fetch_text(urls: list[str], timeout: int = 30) -> tuple[str | None, str | None]:
    for url in urls:
        try:
            resp = requests.get(url, timeout=timeout, headers={"User-Agent": "materialsgraph/0.1"})
            if resp.ok and resp.text.strip():
                return resp.text, url
        except requests.RequestException:
            continue
    return None, None


def pull(csv_path: str | None = None) -> Path:
    if csv_path:
        text = Path(csv_path).read_text()
        src_url = csv_path
    else:
        text, src_url = fetch_text(DEFAULT_CSV_URLS)
        if text is None:
            raise SystemExit("could not download the Liverpool CSV; pass --csv <local file> (download it from the repository first)")
    license_text, license_url = fetch_text(LICENSE_URLS)
    records = parse_csv(text)
    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    RAW_PATH.write_text(
        json.dumps(
            {
                "source": src_url,
                "license_url": license_url,
                "license_excerpt": (license_text or "")[:500] or None,
                "records": [r.model_dump() for r in records],
            },
            indent=2,
        )
    )
    print(f"Saved {len(records)} measured conductivities to {RAW_PATH} (license: {license_url or 'not found - check manually'})")
    return RAW_PATH


def load_saved() -> tuple[list[MeasuredPropertyRecord], str | None]:
    payload = json.loads(RAW_PATH.read_text())
    return [MeasuredPropertyRecord(**r) for r in payload["records"]], payload.get("license_excerpt")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Download/parse the Liverpool Li-ion conductivity dataset")
    parser.add_argument("--csv", help="local CSV path instead of downloading")
    args = parser.parse_args(argv)
    pull(args.csv)


if __name__ == "__main__":
    main()
