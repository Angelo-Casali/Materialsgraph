"""Loads data into Neo4j against schema.cypher."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from neo4j import GraphDatabase, Session

from materialsgraph.ingestion.mp_client import RawMaterialRecord

SCHEMA_PATH = Path(__file__).parent.parent / "graph" / "schema.cypher"
DATA_PATH = Path("data/raw/battery_electrodes_li.json")

DOMAIN_NAME = "Battery"
APPLICATION_NAME = "Li-ion insertion electrode"
MP_SOURCE_ID = "materials-project"

# unit/description per PropertyType. ionic_conductivity and cycling_stability
# have no data yet in this batch -- they're seeded anyway so the "MISSING"
# query pattern from technical_buildplan.md Section 2 has a PropertyType to
# point at; the gap is the absence of PropertyValue nodes, not the absence of
# the PropertyType itself.
PROPERTY_TYPES = [
    {"name": "band_gap", "unit": "eV", "description": None},
    {"name": "formation_energy", "unit": "eV/atom", "description": None},
    {
        "name": "energy_above_hull",
        "unit": "eV/atom",
        "description": "distance above the convex hull; 0 = ground-state stable",
    },
    {"name": "voltage", "unit": "V", "description": None},
    {"name": "specific_capacity", "unit": "mAh/g", "description": None},
    {"name": "ionic_conductivity", "unit": "S/cm", "description": None},
    {
        "name": "cycling_stability",
        "unit": "% retention",
        "description": "capacity retention after N cycles",
    },
]
PROPERTY_UNITS = {p["name"]: p["unit"] for p in PROPERTY_TYPES}

REQUIRED_PROPERTIES = [
    {"name": "ionic_conductivity", "target_min": 1e-4, "target_max": None, "importance": "high"},
    {"name": "voltage", "target_min": None, "target_max": None, "importance": "high"},
    {"name": "specific_capacity", "target_min": None, "target_max": None, "importance": "high"},
]

# Properties Materials Project computes via DFT for every record we pull.
DFT_PROPERTIES = ["band_gap", "formation_energy", "energy_above_hull"]
# Properties that only exist for the id_discharge compound in an electrode
# (see mp_client.build_records) -- absent for the other materials, on purpose.
ELECTRODE_PROPERTIES = ["voltage", "specific_capacity"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_schema_statements() -> list[str]:
    """Split schema.cypher into individual runnable statements.

    Strips the leading documentation comments (see schema.cypher's header)
    and blank lines, leaving just the CREATE CONSTRAINT / CREATE INDEX
    statements -- all IF NOT EXISTS, so safe to re-run.
    """
    statements = []
    for line in SCHEMA_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        statements.append(line.rstrip(";"))
    return statements


def apply_schema(session: Session) -> None:
    """Run schema.cypher's constraints/indexes. Safe to re-run."""
    statements = _read_schema_statements()
    for statement in statements:
        session.run(statement)
    print(f"Applied {len(statements)} constraints/indexes")


def seed_reference_data(session: Session) -> None:
    """Seed Domain/PropertyType/Application/Source reference data. Safe to re-run (MERGE)."""
    session.run("MERGE (:Domain {name: $name})", name=DOMAIN_NAME)

    for prop in PROPERTY_TYPES:
        session.run(
            "MERGE (p:PropertyType {name: $name}) SET p.unit = $unit, p.description = $description",
            name=prop["name"],
            unit=prop["unit"],
            description=prop["description"],
        )

    session.run(
        """
        MERGE (a:Application {name: $app_name})
        MERGE (d:Domain {name: $domain_name})
        MERGE (a)-[:BELONGS_TO]->(d)
        """,
        app_name=APPLICATION_NAME,
        domain_name=DOMAIN_NAME,
    )

    for req in REQUIRED_PROPERTIES:
        session.run(
            """
            MATCH (d:Domain {name: $domain_name})
            MATCH (p:PropertyType {name: $prop_name})
            MERGE (d)-[r:REQUIRES_PROPERTY]->(p)
            SET r.target_min = $target_min, r.target_max = $target_max, r.importance = $importance
            """,
            domain_name=DOMAIN_NAME,
            prop_name=req["name"],
            target_min=req["target_min"],
            target_max=req["target_max"],
            importance=req["importance"],
        )

    # "database" is a new Source.type value alongside paper/book/video from
    # technical_buildplan.md -- that doc's Source table needs updating to match.
    session.run(
        """
        MERGE (s:Source {source_id: $source_id})
        ON CREATE SET s.ingested_at = $now
        SET s.title = $title, s.type = $type, s.url_or_doi = $url
        """,
        source_id=MP_SOURCE_ID,
        title="Materials Project",
        type="database",
        url="https://materialsproject.org",
        now=_now(),
    )

    # The Application-Source link represents "this tag concept comes from MP
    # data" and holds regardless of how many materials currently carry the
    # tag, so it's seeded once here rather than re-merged on every one of the
    # 56 tagged materials in load_material.
    session.run(
        """
        MATCH (a:Application {name: $app_name})
        MATCH (s:Source {source_id: $source_id})
        MERGE (a)-[:TAGGED_BY]->(s)
        """,
        app_name=APPLICATION_NAME,
        source_id=MP_SOURCE_ID,
    )


def _set_property_value(session: Session, mp_id: str, prop_name: str, value: float | None) -> bool:
    """MERGE a PropertyValue for one material's property, if the value is present.

    Merges on (Material)-[:HAS_PROPERTY]->(PropertyValue {property_type, source_type})
    -- anchored at the specific Material node, not on value/unit alone. Several
    materials in this batch share identical values (e.g. every record has
    energy_above_hull == 0.0 in the first 150), so merging on value would
    collapse them onto one shared PropertyValue node instead of one per material.
    """
    if value is None:
        return False
    session.run(
        """
        MATCH (m:Material {mp_id: $mp_id})
        MATCH (pt:PropertyType {name: $prop_name})
        MATCH (src:Source {source_id: $source_id})
        MERGE (m)-[:HAS_PROPERTY]->(pv:PropertyValue {property_type: $prop_name, source_type: 'dft'})
        ON CREATE SET pv.computed_at = $now
        SET pv.value = $value, pv.unit = $unit, pv.confidence = 'high'
        MERGE (pv)-[:OF_TYPE]->(pt)
        MERGE (pv)-[:SOURCED_FROM]->(src)
        """,
        mp_id=mp_id,
        prop_name=prop_name,
        source_id=MP_SOURCE_ID,
        unit=PROPERTY_UNITS[prop_name],
        value=value,
        now=_now(),
    )
    return True


def load_material(session: Session, record: RawMaterialRecord) -> None:
    session.run(
        """
        MERGE (m:Material {mp_id: $mp_id})
        ON CREATE SET m.created_at = $now
        SET m.formula = $formula, m.data_source = $data_source
        """,
        mp_id=record.mp_id,
        formula=record.formula,
        data_source=record.data_source,
        now=_now(),
    )

    for prop_name in DFT_PROPERTIES + ELECTRODE_PROPERTIES:
        _set_property_value(session, record.mp_id, prop_name, getattr(record, prop_name))

    # Only the id_discharge compounds (where voltage/specific_capacity are
    # present) get tagged as the electrode application -- the other materials
    # in the pathway play a different role and aren't "the electrode" itself.
    if record.voltage is not None and record.specific_capacity is not None:
        session.run(
            """
            MATCH (m:Material {mp_id: $mp_id})
            MATCH (a:Application {name: $app_name})
            MERGE (m)-[:USED_IN {confirmed: true}]->(a)
            """,
            mp_id=record.mp_id,
            app_name=APPLICATION_NAME,
        )


def load_records(session: Session, records: list[dict]) -> None:
    loaded = 0
    for raw in records:
        try:
            record = RawMaterialRecord(**raw)
            load_material(session, record)
            loaded += 1
        except Exception as exc:
            print(f"Skipping record {raw.get('mp_id', '<unknown>')}: {exc}")
    print(f"Loaded {loaded} of {len(records)} materials")


def print_summary(session: Session) -> None:
    material_count = session.run("MATCH (m:Material) RETURN count(m) AS n").single()["n"]
    print(f"Material nodes: {material_count}")

    print("PropertyValue nodes by type:")
    for row in session.run(
        "MATCH (pv:PropertyValue) RETURN pv.property_type AS ptype, count(pv) AS n ORDER BY ptype"
    ):
        print(f"  {row['ptype']}: {row['n']}")

    used_in_count = session.run("MATCH ()-[r:USED_IN]->() RETURN count(r) AS n").single()["n"]
    print(f"USED_IN edges: {used_in_count}")


def main() -> None:
    load_dotenv()
    uri = os.environ["NEO4J_URI"]
    user = os.environ["NEO4J_USER"]
    password = os.environ["NEO4J_PASSWORD"]

    records = json.loads(DATA_PATH.read_text())

    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        with driver.session() as session:
            apply_schema(session)
            seed_reference_data(session)
            load_records(session, records)
            print_summary(session)
    finally:
        driver.close()


if __name__ == "__main__":
    main()
