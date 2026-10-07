"""Materials Project pull (no LLM).

Pulls insertion-electrode data for each working ion (Li, Na, K, Mg) plus core
material properties, composition and symmetry, normalizes it, and writes one
JSON file per ion to data/raw/. Does not touch Neo4j -- that's
schema_loader.py's job.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv

from materialsgraph import chem
from materialsgraph.graph.reference import WORKING_IONS
from materialsgraph.ingestion.models import RawMaterialRecord  # noqa: F401  (re-export for older imports)

MAX_RECORDS = 150
RAW_DIR = Path("data/raw")


def output_path(ion: str) -> Path:
    return RAW_DIR / f"battery_electrodes_{ion.lower()}.json"


# GNoME-derived summary docs are tagged via builder_meta.batch_id (e.g.
# "gnome_r2scan_statics") and carry builder_meta.license == "BY-NC" -- a
# non-commercial license, unlike the rest of Materials Project. That's why
# builder_meta is fetched alongside the property fields: without it, GNoME and
# regular MP entries would silently end up mixed under one license.
SUMMARY_FIELDS = [
    "material_id",
    "formula_pretty",
    "band_gap",
    "formation_energy_per_atom",
    "energy_above_hull",
    "is_stable",
    "symmetry",
    "builder_meta",
]
ELECTRODE_FIELDS = [
    "material_ids",
    "working_ion",
    "average_voltage",
    "capacity_grav",
    "id_discharge",
]

GNOME_BATCH_PREFIX = "gnome"


def _data_source_for(summary_doc) -> str:
    meta = getattr(summary_doc, "builder_meta", None)
    batch_id = getattr(meta, "batch_id", None) or ""
    if batch_id.startswith(GNOME_BATCH_PREFIX):
        return "gnome"  # BY-NC licensed -- see SUMMARY_FIELDS comment above
    return "materials_project"


def _license_for(data_source: str) -> str:
    return "BY-NC" if data_source == "gnome" else "CC-BY-4.0"


def fetch_electrodes(mpr, working_ion: str) -> list:
    """Pull insertion electrodes for one working ion and the material_ids each one spans."""
    from mp_api.client.core.exceptions import MPRestError

    try:
        return mpr.materials.insertion_electrodes.search(working_ion=working_ion, fields=ELECTRODE_FIELDS)
    except MPRestError as exc:
        print(f"Failed to fetch {working_ion} insertion electrodes: {exc}")
        return []


# kept for backwards compatibility with the first version of this module
def fetch_li_electrodes(mpr) -> list:
    return fetch_electrodes(mpr, "Li")


def fetch_material_summaries(mpr, material_ids: list[str]) -> dict[str, object]:
    """Batch-fetch core properties for every material_id."""
    from mp_api.client.core.exceptions import MPRestError

    if not material_ids:
        return {}
    try:
        docs = mpr.materials.summary.search(material_ids=material_ids, fields=SUMMARY_FIELDS)
    except MPRestError as exc:
        print(f"Failed to fetch material summaries: {exc}")
        return {}
    return {str(doc.material_id): doc for doc in docs}


def _symmetry(summary) -> tuple[str | None, int | None]:
    sym = getattr(summary, "symmetry", None)
    if sym is None:
        return None, None
    symbol = getattr(sym, "symbol", None)
    number = getattr(sym, "number", None)
    return (str(symbol) if symbol else None), (int(number) if number is not None else None)


def build_records(electrodes: list, summaries: dict[str, object]) -> list[RawMaterialRecord]:
    """Merge electrode-level and material-level data into RawMaterialRecords.

    average_voltage and capacity_grav describe the whole charge<->discharge
    couple, not any single material in it -- stamping them onto every id in
    material_ids would give the charged framework (e.g. FePO4) the same
    voltage as the discharged compound (e.g. LiFePO4), which is wrong. They're
    attached only to id_discharge, the compound they're actually meaningful
    for; every other material_id in the electrode still gets a record (formula,
    band_gap, etc. are still real properties of that material on its own) but
    with voltage/specific_capacity left absent.

    Longer term this points at voltage/capacity belonging on their own
    Electrode node related to Material via INVOLVES {role} -- flagged as a known
    MVP simplification, not fixed here.

    A material_id can appear in more than one electrode's charge/discharge
    path; the first electrode encountered wins.
    """
    records: dict[str, RawMaterialRecord] = {}
    for electrode in electrodes:
        discharge_id = str(electrode.id_discharge) if electrode.id_discharge is not None else None
        for mp_id in electrode.material_ids or []:
            mp_id = str(mp_id)
            if mp_id in records:
                continue
            summary = summaries.get(mp_id)
            if summary is None:
                continue
            is_discharge = mp_id == discharge_id
            formula = summary.formula_pretty
            try:
                composition = chem.parse_composition(formula)
                reduced = chem.reduced_formula(formula)
            except chem.FormulaError as exc:
                print(f"Skipping {mp_id}: {exc}")
                continue
            spacegroup, sg_number = _symmetry(summary)
            data_source = _data_source_for(summary)
            try:
                records[mp_id] = RawMaterialRecord(
                    mp_id=mp_id,
                    material_key=f"mp:{mp_id}",
                    formula=formula,
                    reduced_formula=reduced,
                    composition=composition,
                    spacegroup=spacegroup,
                    spacegroup_number=sg_number,
                    is_stable=getattr(summary, "is_stable", None),
                    band_gap=summary.band_gap,
                    formation_energy=summary.formation_energy_per_atom,
                    energy_above_hull=summary.energy_above_hull,
                    voltage=electrode.average_voltage if is_discharge else None,
                    specific_capacity=electrode.capacity_grav if is_discharge else None,
                    working_ion=str(electrode.working_ion),
                    data_source=data_source,
                    license=_license_for(data_source),
                )
            except Exception as exc:
                print(f"Skipping {mp_id}: {exc}")
    return list(records.values())


def pull_ion(mpr, ion: str, max_records: int = MAX_RECORDS) -> Path:
    electrodes = fetch_electrodes(mpr, ion)
    print(f"[{ion}] Fetched {len(electrodes)} insertion electrodes")

    all_material_ids = sorted({str(mid) for electrode in electrodes for mid in (electrode.material_ids or [])})
    summaries = fetch_material_summaries(mpr, all_material_ids)
    print(f"[{ion}] Fetched summaries for {len(summaries)} unique materials")

    records = build_records(electrodes, summaries)
    before_filter = len(records)
    records = [r for r in records if r.energy_above_hull is not None]
    if len(records) < before_filter:
        print(f"[{ion}] Dropped {before_filter - len(records)} records with no energy_above_hull")

    records.sort(key=lambda r: r.energy_above_hull)
    records = records[:max_records]

    path = output_path(ion)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([r.model_dump() for r in records], indent=2))
    print(f"[{ion}] Saved {len(records)} records to {path}")
    return path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Pull battery electrode materials from Materials Project")
    parser.add_argument("--ions", default="Li", help=f"comma-separated working ions, subset of {','.join(WORKING_IONS)}")
    parser.add_argument("--max-records", type=int, default=MAX_RECORDS)
    args = parser.parse_args(argv)

    load_dotenv()
    api_key = os.environ["MP_API_KEY"]
    ions = [i.strip() for i in args.ions.split(",") if i.strip()]
    for ion in ions:
        if ion not in WORKING_IONS:
            raise SystemExit(f"unsupported working ion {ion!r}; choose from {WORKING_IONS}")

    from mp_api.client import MPRester  # lazy: heavy import

    with MPRester(api_key=api_key) as mpr:
        for ion in ions:
            pull_ion(mpr, ion, args.max_records)


if __name__ == "__main__":
    main()
