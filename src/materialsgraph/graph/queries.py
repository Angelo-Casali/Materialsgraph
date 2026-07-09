"""Reusable Cypher queries, incl. the gap-query from the technical build plan."""

from __future__ import annotations

import json
import os

from dotenv import load_dotenv
from neo4j import GraphDatabase, Session

from materialsgraph.ingestion.schema_loader import APPLICATION_NAME


def get_property_coverage(session: Session, domain: str = "Battery") -> list[dict]:
    """For every PropertyType the Domain requires, how much data do we actually have.

    Generalizes the one-off ionic_conductivity gap check into something that
    works for any property a Domain requires, not just the one we happened to
    check by hand.
    """
    query = """
        MATCH (d:Domain {name: $domain})-[:REQUIRES_PROPERTY]->(pt:PropertyType)
        OPTIONAL MATCH (m:Material)-[:USED_IN {confirmed: true}]->(:Application)-[:BELONGS_TO]->(d)
        WITH pt, collect(DISTINCT m) AS domain_materials
        RETURN pt.name AS property_type,
               size(domain_materials) AS total_materials_in_domain,
               size([m IN domain_materials WHERE (m)-[:HAS_PROPERTY]->(:PropertyValue)-[:OF_TYPE]->(pt)])
                   AS materials_with_data
        ORDER BY property_type
    """
    results = []
    for row in session.run(query, domain=domain):
        total = row["total_materials_in_domain"]
        with_data = row["materials_with_data"]
        coverage_pct = round(100.0 * with_data / total, 1) if total else 0.0
        results.append(
            {
                "property_type": row["property_type"],
                "total_materials_in_domain": total,
                "materials_with_data": with_data,
                "materials_missing": total - with_data,
                "coverage_pct": coverage_pct,
            }
        )
    return results


def get_missing_property(
    session: Session, property_type: str, application: str = APPLICATION_NAME
) -> list[dict]:
    """The validated gap query from technical_buildplan.md Section 2, parameterized on property_type."""
    query = """
        MATCH (m:Material)-[:USED_IN {confirmed: true}]->(:Application {name: $application})
        OPTIONAL MATCH (m)-[:HAS_PROPERTY]->(pv:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: $property_type})
        RETURN m.mp_id AS mp_id, m.formula AS formula,
               CASE WHEN pv IS NULL THEN "MISSING" ELSE pv.value END AS value,
               CASE WHEN pv IS NULL THEN "gap" ELSE pv.source_type END AS status
        ORDER BY mp_id
    """
    return [dict(row) for row in session.run(query, application=application, property_type=property_type)]


def get_top_candidates(
    session: Session,
    max_energy_above_hull: float = 0.05,
    min_specific_capacity: float | None = None,
    limit: int = 10,
) -> list[dict]:
    """Rank tagged electrode candidates by specific_capacity, filtered by stability."""
    query = """
        MATCH (m:Material)-[:USED_IN {confirmed: true}]->()
        MATCH (m)-[:HAS_PROPERTY]->(eah:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "energy_above_hull"})
        WHERE eah.value <= $max_energy_above_hull
        MATCH (m)-[:HAS_PROPERTY]->(v:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "voltage"})
        MATCH (m)-[:HAS_PROPERTY]->(sc:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "specific_capacity"})
        WHERE $min_specific_capacity IS NULL OR sc.value >= $min_specific_capacity
        RETURN DISTINCT m.mp_id AS mp_id, m.formula AS formula, v.value AS voltage,
               sc.value AS specific_capacity, eah.value AS energy_above_hull
        ORDER BY specific_capacity DESC
        LIMIT $limit
    """
    return [
        dict(row)
        for row in session.run(
            query,
            max_energy_above_hull=max_energy_above_hull,
            min_specific_capacity=min_specific_capacity,
            limit=limit,
        )
    ]


def get_electrode_summary(session: Session) -> list[dict]:
    """Flat listing of all tagged electrode materials, for sanity-checking and quick exploration."""
    query = """
        MATCH (m:Material)-[:USED_IN {confirmed: true}]->(:Application {name: $application})
        MATCH (m)-[:HAS_PROPERTY]->(v:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "voltage"})
        MATCH (m)-[:HAS_PROPERTY]->(sc:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "specific_capacity"})
        MATCH (m)-[:HAS_PROPERTY]->(eah:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "energy_above_hull"})
        RETURN m.mp_id AS mp_id, m.formula AS formula, v.value AS voltage,
               sc.value AS specific_capacity, eah.value AS energy_above_hull
        ORDER BY mp_id
    """
    return [dict(row) for row in session.run(query, application=APPLICATION_NAME)]


if __name__ == "__main__":
    load_dotenv()
    driver = GraphDatabase.driver(
        os.environ["NEO4J_URI"],
        auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"]),
    )
    try:
        with driver.session() as session:
            for label, result in [
                ("get_property_coverage()", get_property_coverage(session)),
                ("get_missing_property('ionic_conductivity')", get_missing_property(session, "ionic_conductivity")),
                ("get_top_candidates()", get_top_candidates(session)),
                ("get_electrode_summary()", get_electrode_summary(session)),
            ]:
                print(f"\n--- {label} ---")
                print(json.dumps(result, indent=2))
    finally:
        driver.close()
