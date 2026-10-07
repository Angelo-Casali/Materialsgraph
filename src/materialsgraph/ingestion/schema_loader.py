"""Applies schema.cypher, seeds reference data, and loads ingestion records into Neo4j.

All MERGEs are delegated to graph/writers.py so that every write in the
codebase goes through one audited module.
"""

from __future__ import annotations

import json
from pathlib import Path

from neo4j import Session

from materialsgraph.graph import writers

# Backwards-compatible re-exports (older code imported these from here).
from materialsgraph.graph.reference import (
    APPLICATION_NAME,  # noqa: F401
    APPLICATIONS,
    DFT_PROPERTIES,
    DOMAIN_NAME,
    ELECTRODE_PROPERTIES,
    MP_SOURCE_ID,
    PROPERTY_TYPES,
    PROPERTY_UNITS,
    REQUIRED_PROPERTIES,
    SEED_SOURCES,
    insertion_electrode_application,
)
from materialsgraph.ingestion.models import (
    ExternalPropertyRecord,
    MeasuredPropertyRecord,
    MoleculeRecord,
    RawMaterialRecord,
)

SCHEMA_PATH = Path(__file__).parent.parent / "graph" / "schema.cypher"
RAW_DIR = Path("data/raw")
LEGACY_DATA_PATH = RAW_DIR / "battery_electrodes_li.json"


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def _read_schema_statements() -> list[str]:
    """Split schema.cypher into runnable statements: one per non-comment line, all IF NOT EXISTS."""
    statements = []
    for line in SCHEMA_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        statements.append(line.rstrip(";"))
    return statements


def apply_schema(session: Session) -> int:
    """Run schema.cypher's constraints/indexes. Safe to re-run."""
    statements = _read_schema_statements()
    for statement in statements:
        session.run(statement)
    print(f"Applied {len(statements)} constraints/indexes")
    return len(statements)


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

def seed_reference_data(session: Session, *, with_elements: bool = True) -> None:
    """Seed Domain / PropertyType / Application / requirement / Source / Element reference data (MERGE, re-runnable)."""
    writers.upsert_domain(session, DOMAIN_NAME)

    for prop in PROPERTY_TYPES:
        writers.upsert_property_type(session, prop["name"], prop["unit"], prop["description"], prop.get("plausible"))

    for name, spec in APPLICATIONS.items():
        writers.upsert_application(session, name, DOMAIN_NAME, spec.get("description"), spec.get("aliases"))
        for req in spec.get("requires", []):
            writers.upsert_requirement(
                session,
                application=name,
                property_type=req["property_type"],
                target_min=req["target_min"],
                target_max=req["target_max"],
                importance=req["importance"],
            )

    for req in REQUIRED_PROPERTIES:
        writers.upsert_requirement(
            session,
            domain=DOMAIN_NAME,
            property_type=req["name"],
            target_min=req["target_min"],
            target_max=req["target_max"],
            importance=req["importance"],
        )

    for src in SEED_SOURCES:
        writers.upsert_source(
            session,
            source_id=src["source_id"],
            title=src["title"],
            type=src["type"],
            url_or_doi=src["url_or_doi"],
            license=src.get("license"),
            provider=src.get("provider"),
        )

    if with_elements:
        from materialsgraph.ingestion.elements import seed_elements  # lazy: pymatgen

        n = seed_elements(session)
        print(f"Seeded {n} elements")


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_material(session: Session, record: RawMaterialRecord) -> None:
    """One Materials Project record -> Material, COMPOSED_OF, dft PropertyValues, computed USED_IN."""
    key = record.key()
    composition = dict(record.composition)
    reduced = record.reduced_formula
    if not composition or not reduced:
        # legacy JSON written before composition/reduced_formula existed
        from materialsgraph import chem  # lazy: pymatgen

        try:
            composition = composition or chem.parse_composition(record.formula)
            reduced = reduced or chem.reduced_formula(record.formula)
        except chem.FormulaError as exc:
            print(f"  {record.mp_id}: could not parse composition ({exc})")

    writers.upsert_material(
        session,
        material_key=key,
        formula=record.formula,
        reduced_formula=reduced,
        kind="crystal",
        mp_id=record.mp_id,
        spacegroup=record.spacegroup,
        spacegroup_number=record.spacegroup_number,
        data_source=record.data_source,
        license=record.license or ("BY-NC" if record.data_source == "gnome" else "CC-BY-4.0"),
        provider="materials_project",
        external_ids=[f"mp:{record.mp_id}"],
    )
    if composition:
        writers.upsert_composed_of(session, key, composition)

    for prop_name in DFT_PROPERTIES + ELECTRODE_PROPERTIES:
        value = getattr(record, prop_name)
        if value is None:
            continue
        writers.upsert_property_value(
            session,
            material_key=key,
            property_type=prop_name,
            value=value,
            unit=PROPERTY_UNITS[prop_name],
            source_id=MP_SOURCE_ID,
            source_type="dft",
            confidence="high",
            confirmed=True,  # deterministic database value, not an AI suggestion
        )

    # Only the id_discharge compounds (where voltage/specific_capacity are
    # present) get tagged as the electrode application. basis='computed' records
    # that MP enumerated this electrode computationally -- it is not an
    # experimentally demonstrated application.
    if record.voltage is not None and record.specific_capacity is not None:
        writers.upsert_used_in(
            session,
            material_key=key,
            application=insertion_electrode_application(record.working_ion),
            source_id=MP_SOURCE_ID,
            confirmed=True,
            basis="computed",
        )


def load_records(session: Session, records: list[dict]) -> int:
    loaded = 0
    for raw in records:
        try:
            record = RawMaterialRecord(**raw)
            load_material(session, record)
            loaded += 1
        except Exception as exc:
            print(f"Skipping record {raw.get('mp_id', '<unknown>')}: {exc}")
    print(f"Loaded {loaded} of {len(records)} materials")
    return loaded


def load_external_records(session: Session, records: list[ExternalPropertyRecord]) -> int:
    """OPTIMADE records: attach to an existing material when (reduced_formula, spacegroup) matches, else create <provider>:<id>."""
    loaded = 0
    for rec in records:
        match = session.run(
            """
            MATCH (m:Material {reduced_formula: $rf})
            WHERE $sg IS NULL OR m.spacegroup_number IS NULL OR m.spacegroup_number = $sg
            RETURN m.material_key AS k, m.spacegroup_number AS sg
            ORDER BY CASE WHEN m.spacegroup_number = $sg THEN 0 ELSE 1 END, k
            LIMIT 1
            """,
            rf=rec.reduced_formula,
            sg=rec.spacegroup_number,
        ).single()
        if match:
            key = match["k"]
            writers.upsert_material(
                session,
                material_key=key,
                formula=session.run("MATCH (m:Material {material_key:$k}) RETURN m.formula AS f", k=key).single()["f"],
                external_ids=[rec.key()],
            )
        else:
            key = rec.key()
            writers.upsert_material(
                session,
                material_key=key,
                formula=rec.formula,
                reduced_formula=rec.reduced_formula,
                kind="crystal",
                spacegroup_number=rec.spacegroup_number,
                data_source=rec.provider,
                license=rec.license,
                provider=rec.provider,
                external_ids=[rec.key()],
            )
            if rec.composition:
                writers.upsert_composed_of(session, key, rec.composition)
        for prop, value in rec.properties.items():
            if prop not in PROPERTY_UNITS:
                continue
            writers.upsert_property_value(
                session,
                material_key=key,
                property_type=prop,
                value=value,
                unit=PROPERTY_UNITS[prop],
                source_id=rec.provider,
                source_type="dft",
                confidence="high",
                confirmed=True,
            )
        loaded += 1
    print(f"Loaded {loaded} external records")
    return loaded


def load_measured_records(session: Session, records: list[MeasuredPropertyRecord]) -> int:
    """Curated experimental datasets (e.g. Liverpool ionics). Creates lit: stubs when no graph material matches."""
    from materialsgraph.harvest.resolve import resolve_formula  # lazy

    loaded = 0
    for rec in records:
        res = resolve_formula(rec.formula_raw, session)
        if res.material_key is None:
            print(f"  skip {rec.formula_raw!r}: {res.status}")
            continue
        if res.status in {"new_crystal", "doped_variant"}:
            writers.upsert_material(
                session,
                material_key=res.material_key,
                formula=res.reduced_formula or rec.formula_raw,
                reduced_formula=res.reduced_formula,
                kind="crystal",
                data_source=rec.dataset_source_id,
                provider=rec.dataset_source_id,
            )
            if res.composition:
                writers.upsert_composed_of(session, res.material_key, res.composition)
            if res.status == "doped_variant" and res.parent_material_key:
                writers.upsert_similar_to(
                    session, from_key=res.material_key, to_key=res.parent_material_key,
                    method="doped_variant_of", score=res.parent_score or 0.0, confirmed=False,
                )
        if rec.source_id != rec.dataset_source_id:
            writers.upsert_source(
                session,
                source_id=rec.source_id,
                title=rec.title or rec.source_id,
                type="paper",
                url_or_doi=f"https://doi.org/{rec.doi}" if rec.doi else None,
                doi=rec.doi,
                year=rec.year,
                provider=rec.dataset_source_id,
            )
        writers.upsert_property_value(
            session,
            material_key=res.material_key,
            property_type=rec.property_type,
            value=rec.value,
            unit=rec.unit,
            source_id=rec.source_id,
            source_type="measured",
            confidence="high",
            confirmed=True,  # curated experimental dataset, human-compiled
            conditions=rec.conditions,
            extraction_method=f"dataset:{rec.dataset_source_id}",
        )
        loaded += 1
    print(f"Loaded {loaded} measured values")
    return loaded


def load_molecules(session: Session, records: list[MoleculeRecord], source_id: str) -> int:
    from materialsgraph import chem  # lazy

    loaded = 0
    for rec in records:
        try:
            composition = chem.parse_composition(rec.formula)
            reduced = chem.reduced_formula(rec.formula)
        except chem.FormulaError:
            composition, reduced = {}, None
        writers.upsert_material(
            session,
            material_key=rec.key(),
            formula=rec.formula,
            reduced_formula=reduced,
            kind="molecule",
            smiles=rec.smiles,
            inchikey=rec.inchikey,
            common_name=rec.common_name,
            data_source=source_id,
            provider=source_id,
            external_ids=[f"pubchem:{rec.cid}"] if rec.cid else [],
        )
        if composition:
            writers.upsert_composed_of(session, rec.key(), composition)
        if rec.molecular_weight is not None:
            writers.upsert_property_value(
                session,
                material_key=rec.key(),
                property_type="molecular_weight",
                value=rec.molecular_weight,
                unit=PROPERTY_UNITS["molecular_weight"],
                source_id=source_id,
                source_type="measured",
                confidence="high",
                confirmed=True,
            )
        for role in rec.roles:
            if role in APPLICATIONS:
                writers.upsert_used_in(
                    session,
                    material_key=rec.key(),
                    application=role,
                    source_id=source_id,
                    confirmed=True,
                    basis="curated",  # hand-entered alias table, see harvest/aliases.py
                )
        loaded += 1
    print(f"Loaded {loaded} molecules")
    return loaded


# ---------------------------------------------------------------------------
# Migration for graphs written by the first loader
# ---------------------------------------------------------------------------

def backfill_v2(session: Session) -> None:
    """Idempotent SETs that bring a v1 graph (mp_id-keyed) up to the v2 property set.

    Does *not* fix the PropertyValue merge-key change (v1 merged on
    {property_type, source_type}); prefer `mg schema reset && mg load` for
    the 150 regenerable records. Provided for completeness.
    """
    session.run(
        "MATCH (m:Material) WHERE m.material_key IS NULL AND m.mp_id IS NOT NULL "
        "SET m.material_key = 'mp:' + m.mp_id, m.kind = coalesce(m.kind, 'crystal'), "
        "m.provider = coalesce(m.provider, 'materials_project')"
    )
    session.run(
        "MATCH (pv:PropertyValue)-[:SOURCED_FROM]->(s:Source) WHERE pv.source_id IS NULL "
        "SET pv.source_id = s.source_id, pv.conditions = coalesce(pv.conditions, ''), "
        "pv.confirmed = coalesce(pv.confirmed, pv.source_type = 'dft')"
    )
    session.run(
        "MATCH (m:Material)-[u:USED_IN]->(a:Application)-[:TAGGED_BY]->(s:Source) WHERE u.source_id IS NULL "
        "SET u.source_id = s.source_id, u.basis = coalesce(u.basis, 'computed')"
    )
    print("Backfill complete")


def print_summary(session: Session) -> None:
    rows = {
        "Material nodes": "MATCH (m:Material) RETURN count(m) AS n",
        "  of which molecules": "MATCH (m:Material {kind:'molecule'}) RETURN count(m) AS n",
        "Element nodes": "MATCH (e:Element) RETURN count(e) AS n",
        "Source nodes": "MATCH (s:Source) RETURN count(s) AS n",
        "Chunk nodes": "MATCH (c:Chunk) RETURN count(c) AS n",
        "Gap nodes": "MATCH (g:Gap) RETURN count(g) AS n",
        "USED_IN edges": "MATCH ()-[r:USED_IN]->() RETURN count(r) AS n",
        "  unconfirmed": "MATCH ()-[r:USED_IN {confirmed:false}]->() RETURN count(r) AS n",
        "SIMILAR_TO edges": "MATCH ()-[r:SIMILAR_TO]->() RETURN count(r) AS n",
    }
    for label, q in rows.items():
        print(f"{label}: {session.run(q).single()['n']}")
    print("PropertyValue nodes by type / source_type:")
    for row in session.run(
        "MATCH (pv:PropertyValue) RETURN pv.property_type AS ptype, pv.source_type AS st, count(pv) AS n ORDER BY ptype, st"
    ):
        print(f"  {row['ptype']} [{row['st']}]: {row['n']}")


def load_all_raw(session: Session, raw_dir: Path = RAW_DIR) -> int:
    """Load every data/raw/battery_electrodes_*.json file (one per working ion)."""
    files = sorted(raw_dir.glob("battery_electrodes_*.json"))
    if not files and LEGACY_DATA_PATH.exists():
        files = [LEGACY_DATA_PATH]
    total = 0
    for path in files:
        print(f"Loading {path}")
        total += load_records(session, json.loads(path.read_text()))
    return total


def main() -> None:
    from materialsgraph.graph.connection import session as open_session

    with open_session() as s:
        apply_schema(s)
        seed_reference_data(s)
        load_all_raw(s)
        print_summary(s)


if __name__ == "__main__":
    main()
