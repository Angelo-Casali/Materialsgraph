"""Reusable read-only Cypher, incl. the gap-query from the technical build plan.

These functions are also the templates the GraphRAG tools call. They never
write, and they only ever take parameters (no string-formatted user input).
"""

from __future__ import annotations

import json

from neo4j import Session

from materialsgraph.graph.reference import APPLICATION_NAME, DOMAIN_NAME


def get_property_coverage(session: Session, domain: str = DOMAIN_NAME) -> list[dict]:
    """For every PropertyType the Domain requires, how much data do we actually have."""
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


def get_application_coverage(session: Session, application: str) -> list[dict]:
    """Same as above, per Application and against that Application's own requirement targets."""
    query = """
        MATCH (a:Application {name: $application})
        OPTIONAL MATCH (a)-[:REQUIRES_PROPERTY]->(pt:PropertyType)
        WITH a, collect(pt) AS pts
        OPTIONAL MATCH (a)-[:BELONGS_TO]->(d:Domain)-[:REQUIRES_PROPERTY]->(dpt:PropertyType)
        WITH a, CASE WHEN size(pts) > 0 THEN pts ELSE collect(DISTINCT dpt) END AS req
        UNWIND req AS pt
        OPTIONAL MATCH (m:Material)-[:USED_IN {confirmed: true}]->(a)
        WITH pt, collect(DISTINCT m) AS mats
        RETURN pt.name AS property_type, size(mats) AS total,
               size([m IN mats WHERE (m)-[:HAS_PROPERTY]->(:PropertyValue)-[:OF_TYPE]->(pt)]) AS with_data
        ORDER BY property_type
    """
    out = []
    for row in session.run(query, application=application):
        total, with_data = row["total"], row["with_data"]
        out.append(
            {
                "property_type": row["property_type"],
                "total_materials": total,
                "materials_with_data": with_data,
                "materials_missing": total - with_data,
                "coverage_pct": round(100.0 * with_data / total, 1) if total else 0.0,
            }
        )
    return out


def get_missing_property(session: Session, property_type: str, application: str = APPLICATION_NAME) -> list[dict]:
    """The validated gap query from technical_buildplan.md Section 2, parameterized on property_type."""
    query = """
        MATCH (m:Material)-[:USED_IN {confirmed: true}]->(:Application {name: $application})
        OPTIONAL MATCH (m)-[:HAS_PROPERTY]->(pv:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: $property_type})
        RETURN m.material_key AS material_key, m.mp_id AS mp_id, m.formula AS formula,
               CASE WHEN pv IS NULL THEN "MISSING" ELSE pv.value END AS value,
               CASE WHEN pv IS NULL THEN "gap" ELSE pv.source_type END AS status
        ORDER BY material_key
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
        RETURN DISTINCT m.material_key AS material_key, m.mp_id AS mp_id, m.formula AS formula, v.value AS voltage,
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


def get_electrode_summary(session: Session, application: str = APPLICATION_NAME) -> list[dict]:
    """Flat listing of all tagged electrode materials, for sanity-checking and quick exploration."""
    query = """
        MATCH (m:Material)-[:USED_IN {confirmed: true}]->(:Application {name: $application})
        MATCH (m)-[:HAS_PROPERTY]->(v:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "voltage"})
        MATCH (m)-[:HAS_PROPERTY]->(sc:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "specific_capacity"})
        MATCH (m)-[:HAS_PROPERTY]->(eah:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "energy_above_hull"})
        RETURN m.material_key AS material_key, m.mp_id AS mp_id, m.formula AS formula, v.value AS voltage,
               sc.value AS specific_capacity, eah.value AS energy_above_hull
        ORDER BY material_key
    """
    return [dict(row) for row in session.run(query, application=application)]


# ---------------------------------------------------------------------------
# Templates used by the GraphRAG tools (query/tools.py)
# ---------------------------------------------------------------------------

def material_profile(session: Session, material_key: str) -> dict | None:
    """Everything the graph knows about one material, with provenance per value."""
    row = session.run(
        """
        MATCH (m:Material {material_key: $k})
        OPTIONAL MATCH (m)-[c:COMPOSED_OF]->(e:Element)
        WITH m, collect({symbol: e.symbol, stoichiometry: c.stoichiometry, fraction: c.fraction,
                         eu_crm_2023: e.eu_crm_2023, usgs_2022: e.usgs_2022}) AS elements
        OPTIONAL MATCH (m)-[:HAS_PROPERTY]->(pv:PropertyValue)-[:OF_TYPE]->(pt:PropertyType)
        OPTIONAL MATCH (pv)-[:SOURCED_FROM]->(s:Source)
        WITH m, elements, collect({property_type: pt.name, value: pv.value, unit: pv.unit,
                                   source_type: pv.source_type, confirmed: pv.confirmed,
                                   conditions: pv.conditions, source_id: s.source_id,
                                   source_title: s.title, year: s.year}) AS properties
        OPTIONAL MATCH (m)-[u:USED_IN]->(a:Application)
        WITH m, elements, properties, collect({application: a.name, confirmed: u.confirmed,
                                               basis: u.basis, source_id: u.source_id}) AS applications
        OPTIONAL MATCH (m)-[r:SIMILAR_TO]-(n:Material)
        RETURN m {.material_key, .formula, .reduced_formula, .kind, .mp_id, .spacegroup, .common_name,
                  .smiles, .inchikey, .provider, .license} AS material,
               elements, properties, applications,
               collect({material_key: n.material_key, formula: n.formula, method: r.method,
                        score: r.score, confirmed: r.confirmed})[..10] AS similar
        """,
        k=material_key,
    ).single()
    if row is None:
        return None
    out = dict(row)
    out["elements"] = [e for e in out["elements"] if e["symbol"] is not None]
    out["properties"] = [p for p in out["properties"] if p["property_type"] is not None]
    out["applications"] = [a for a in out["applications"] if a["application"] is not None]
    out["similar"] = [s for s in out["similar"] if s["material_key"] is not None]
    return out


def requirements_for(session: Session, application: str) -> list[dict]:
    """Application-level REQUIRES_PROPERTY targets, falling back to the Domain's."""
    rows = [
        dict(r)
        for r in session.run(
            """
            MATCH (a:Application {name: $app})-[r:REQUIRES_PROPERTY]->(pt:PropertyType)
            RETURN pt.name AS property_type, pt.unit AS unit, r.target_min AS target_min,
                   r.target_max AS target_max, r.importance AS importance, 'application' AS level
            """,
            app=application,
        )
    ]
    if rows:
        return rows
    return [
        dict(r)
        for r in session.run(
            """
            MATCH (:Application {name: $app})-[:BELONGS_TO]->(d:Domain)-[r:REQUIRES_PROPERTY]->(pt:PropertyType)
            RETURN pt.name AS property_type, pt.unit AS unit, r.target_min AS target_min,
                   r.target_max AS target_max, r.importance AS importance, 'domain' AS level
            """,
            app=application,
        )
    ]


def gaps_for(session: Session, application: str | None = None, domain: str = DOMAIN_NAME, limit: int = 20) -> list[dict]:
    return [
        dict(r)
        for r in session.run(
            """
            MATCH (d:Domain {name: $domain})-[:HAS_GAP]->(g:Gap)-[:DOCUMENTED_IN]->(s:Source)
            WHERE $application IS NULL OR g.application = $application
            RETURN g.gap_id AS gap_id, g.description AS description, g.status AS status, g.confirmed AS confirmed,
                   g.application AS application, s.source_id AS source_id, s.title AS source_title, s.year AS year
            ORDER BY s.year DESC
            LIMIT $limit
            """,
            domain=domain,
            application=application,
            limit=limit,
        )
    ]


def expand_sources(session: Session, source_ids: list[str]) -> list[dict]:
    """Graph neighbourhood of retrieved Sources: the values, tags and gaps they support."""
    return [
        dict(r)
        for r in session.run(
            """
            UNWIND $ids AS sid
            MATCH (s:Source {source_id: sid})
            OPTIONAL MATCH (s)<-[:SOURCED_FROM]-(pv:PropertyValue)<-[:HAS_PROPERTY]-(m:Material)
            WITH s, collect(DISTINCT {material_key: m.material_key, formula: m.formula, property_type: pv.property_type,
                                      value: pv.value, unit: pv.unit, source_type: pv.source_type,
                                      confirmed: pv.confirmed, conditions: pv.conditions}) AS values
            OPTIONAL MATCH (m2:Material)-[u:USED_IN {source_id: s.source_id}]->(a:Application)
            WITH s, values, collect(DISTINCT {material_key: m2.material_key, formula: m2.formula,
                                              application: a.name, confirmed: u.confirmed, basis: u.basis}) AS tags
            OPTIONAL MATCH (g:Gap)-[:DOCUMENTED_IN]->(s)
            RETURN s.source_id AS source_id, s.title AS title, s.year AS year, s.doi AS doi, s.type AS type,
                   s.license AS license,
                   [v IN values WHERE v.material_key IS NOT NULL] AS values,
                   [t IN tags WHERE t.material_key IS NOT NULL] AS tags,
                   collect(DISTINCT {gap_id: g.gap_id, description: g.description, confirmed: g.confirmed}) AS gaps
            """,
            ids=source_ids,
        )
    ]


def citations_for(session: Session, source_ids: list[str]) -> list[dict]:
    if not source_ids:
        return []
    return [
        dict(r)
        for r in session.run(
            """
            UNWIND $ids AS id
            MATCH (s:Source {source_id: id})
            RETURN s.source_id AS source_id, s.title AS title, s.year AS year, s.doi AS doi
            """,
            ids=source_ids,
        )
    ]


def find_materials_by_formula(session: Session, reduced_formula: str) -> list[dict]:
    return [
        dict(r)
        for r in session.run(
            """
            MATCH (m:Material {reduced_formula: $rf})
            OPTIONAL MATCH (m)-[:HAS_PROPERTY]->(pv:PropertyValue {property_type: 'energy_above_hull'})
            RETURN m.material_key AS material_key, m.formula AS formula, m.spacegroup AS spacegroup,
                   m.spacegroup_number AS spacegroup_number, m.kind AS kind, min(pv.value) AS energy_above_hull
            ORDER BY energy_above_hull
            """,
            rf=reduced_formula,
        )
    ]


if __name__ == "__main__":
    from materialsgraph.graph.connection import session as open_session

    with open_session() as s:
        for label, result in [
            ("get_property_coverage()", get_property_coverage(s)),
            ("get_missing_property('ionic_conductivity')", get_missing_property(s, "ionic_conductivity")),
            ("get_top_candidates()", get_top_candidates(s)),
            ("get_electrode_summary()", get_electrode_summary(s)),
        ]:
            print(f"\n--- {label} ---")
            print(json.dumps(result, indent=2, default=str))
