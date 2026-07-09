"""Materials Project pull (no LLM).

Pulls a first batch of Li-ion insertion-electrode data plus core material
properties, normalizes it, and writes it to data/raw/. Does not touch Neo4j
-- that's schema_loader.py's job.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from mp_api.client import MPRester
from mp_api.client.core.exceptions import MPRestError
from pydantic import BaseModel

WORKING_ION = "Li"
MAX_RECORDS = 150
OUTPUT_PATH = Path("data/raw/battery_electrodes_li.json")

# GNoME-derived summary docs are tagged via builder_meta.batch_id (e.g.
# "gnome_r2scan_statics") and carry builder_meta.license == "BY-NC" -- a
# non-commercial license, unlike the rest of Materials Project. That's why
# builder_meta is fetched alongside the four requested property fields below,
# even though it wasn't in the original four-field list: without it, GNoME
# and regular MP entries would silently end up mixed under one license.
SUMMARY_FIELDS = [
    "material_id",
    "formula_pretty",
    "band_gap",
    "formation_energy_per_atom",
    "energy_above_hull",
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


class RawMaterialRecord(BaseModel):
    mp_id: str
    formula: str
    band_gap: float | None = None
    formation_energy: float | None = None
    energy_above_hull: float | None = None
    voltage: float | None = None
    specific_capacity: float | None = None
    working_ion: str
    data_source: str
    # ionic_conductivity is deliberately absent: MP doesn't broadly compute it,
    # and the gap should stay visible in the graph rather than be papered over.


def _data_source_for(summary_doc) -> str:
    meta = getattr(summary_doc, "builder_meta", None)
    batch_id = getattr(meta, "batch_id", None) or ""
    if batch_id.startswith(GNOME_BATCH_PREFIX):
        return "gnome"  # BY-NC licensed -- see SUMMARY_FIELDS comment above
    return "materials_project"


def fetch_li_electrodes(mpr: MPRester) -> list:
    """Pull Li insertion electrodes and the material_ids each one spans."""
    try:
        return mpr.materials.insertion_electrodes.search(
            working_ion=WORKING_ION,
            fields=ELECTRODE_FIELDS,
        )
    except MPRestError as exc:
        print(f"Failed to fetch insertion electrodes: {exc}")
        return []


def fetch_material_summaries(mpr: MPRester, material_ids: list[str]) -> dict[str, object]:
    """Batch-fetch core properties for every material_id in a single call."""
    if not material_ids:
        return {}
    try:
        docs = mpr.materials.summary.search(
            material_ids=material_ids,
            fields=SUMMARY_FIELDS,
        )
    except MPRestError as exc:
        print(f"Failed to fetch material summaries: {exc}")
        return {}
    return {str(doc.material_id): doc for doc in docs}


def build_records(electrodes: list, summaries: dict[str, object]) -> list[RawMaterialRecord]:
    """Merge electrode-level and material-level data into RawMaterialRecords.

    average_voltage and capacity_grav describe the whole charge<->discharge
    couple, not any single material in it -- stamping them onto every id in
    material_ids would give the charged framework (e.g. FePO4) the same
    voltage as the discharged compound (e.g. LiFePO4), which is wrong. They're
    attached only to id_discharge, the compound they're actually meaningful
    for; every other material_id in the electrode still gets a record (formula,
    band_gap, etc. are still real properties of that material on its own) but
    with voltage/specific_capacity left absent, same reasoning as the
    ionic_conductivity gap above.

    Longer term this points at voltage/capacity belonging on their own
    Electrode node (average_voltage, capacity_grav, working_ion) related to
    Material via something like INVOLVES {role: "charged"|"discharged"},
    rather than being pushed onto Material at all -- flagging it as a known
    MVP simplification, not fixing it now.

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
            try:
                records[mp_id] = RawMaterialRecord(
                    mp_id=mp_id,
                    formula=summary.formula_pretty,
                    band_gap=summary.band_gap,
                    formation_energy=summary.formation_energy_per_atom,
                    energy_above_hull=summary.energy_above_hull,
                    voltage=electrode.average_voltage if is_discharge else None,
                    specific_capacity=electrode.capacity_grav if is_discharge else None,
                    working_ion=str(electrode.working_ion),
                    data_source=_data_source_for(summary),
                )
            except Exception as exc:
                print(f"Skipping {mp_id}: {exc}")
    return list(records.values())


def main() -> None:
    load_dotenv()
    api_key = os.environ["MP_API_KEY"]

    with MPRester(api_key=api_key) as mpr:
        electrodes = fetch_li_electrodes(mpr)
        print(f"Fetched {len(electrodes)} Li insertion electrodes")

        all_material_ids = sorted(
            {str(mid) for electrode in electrodes for mid in (electrode.material_ids or [])}
        )
        summaries = fetch_material_summaries(mpr, all_material_ids)
        print(f"Fetched summaries for {len(summaries)} unique materials")

        records = build_records(electrodes, summaries)

    before_filter = len(records)
    records = [r for r in records if r.energy_above_hull is not None]
    if len(records) < before_filter:
        print(f"Dropped {before_filter - len(records)} records with no energy_above_hull")

    records.sort(key=lambda r: r.energy_above_hull)
    records = records[:MAX_RECORDS]

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps([r.model_dump() for r in records], indent=2))
    print(f"Saved {len(records)} records to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
