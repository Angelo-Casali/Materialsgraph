"""Every graph write lives here.

Each upsert's MERGE key maps 1:1 onto a constraint in schema.cypher, which is
how the "never write outside the schema constraints" rule from CLAUDE.md is
enforced in code rather than by convention:

- Material        -> material_key (unique)
- Element         -> symbol (unique)
- Source          -> source_id (unique)
- Gap             -> gap_id (unique)
- Chunk           -> chunk_id (unique)
- PropertyValue   -> (material, property_type, source_id, conditions), anchored
                     at the Material node so identical values on different
                     materials never collapse onto one node
- USED_IN         -> (material, application, source_id)

Anything AI-derived must be written with confirmed=False; the writers accept
`confirmed` explicitly so callers cannot forget to decide.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from neo4j import Session

from materialsgraph.graph.reference import (
    MATERIAL_KINDS,
    PROPERTY_UNITS,
    PV_SOURCE_TYPES,
    SOURCE_TYPES,
    USED_IN_BASES,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _conditions_str(conditions: str | dict | None) -> str:
    """Neo4j MERGE rejects null property values, so conditions are a string ('' = unspecified)."""
    if conditions is None:
        return ""
    if isinstance(conditions, dict):
        return json.dumps(conditions, sort_keys=True) if conditions else ""
    return conditions


# ---------------------------------------------------------------------------
# Reference nodes
# ---------------------------------------------------------------------------

def upsert_domain(s: Session, name: str) -> None:
    s.run("MERGE (:Domain {name: $name})", name=name)


def upsert_property_type(s: Session, name: str, unit: str, description: str | None, plausible: tuple | None = None) -> None:
    s.run(
        """
        MERGE (p:PropertyType {name: $name})
        SET p.unit = $unit, p.description = $description,
            p.plausible_min = $pmin, p.plausible_max = $pmax
        """,
        name=name,
        unit=unit,
        description=description,
        pmin=plausible[0] if plausible else None,
        pmax=plausible[1] if plausible else None,
    )


def upsert_application(s: Session, name: str, domain: str, description: str | None = None, aliases: list[str] | None = None) -> None:
    s.run(
        """
        MERGE (a:Application {name: $name})
        SET a.description = $description, a.aliases = $aliases
        MERGE (d:Domain {name: $domain})
        MERGE (a)-[:BELONGS_TO]->(d)
        """,
        name=name,
        domain=domain,
        description=description,
        aliases=aliases or [],
    )


def upsert_requirement(
    s: Session,
    *,
    property_type: str,
    target_min: float | None,
    target_max: float | None,
    importance: str,
    domain: str | None = None,
    application: str | None = None,
) -> None:
    """(Domain|Application)-[:REQUIRES_PROPERTY]->(PropertyType). Exactly one of domain/application."""
    if (domain is None) == (application is None):
        raise ValueError("pass exactly one of domain= or application=")
    if property_type not in PROPERTY_UNITS:
        raise ValueError(f"unknown property_type {property_type!r}")
    if domain is not None:
        head = "MATCH (h:Domain {name: $head})"
    else:
        head = "MATCH (h:Application {name: $head})"
    s.run(
        f"""
        {head}
        MATCH (p:PropertyType {{name: $prop}})
        MERGE (h)-[r:REQUIRES_PROPERTY]->(p)
        SET r.target_min = $tmin, r.target_max = $tmax, r.importance = $importance
        """,
        head=domain or application,
        prop=property_type,
        tmin=target_min,
        tmax=target_max,
        importance=importance,
    )


def upsert_element(s: Session, *, symbol: str, name: str, atomic_number: int, eu_crm_2023: bool = False, usgs_2022: bool = False, supply_risk_note: str | None = None) -> None:
    s.run(
        """
        MERGE (e:Element {symbol: $symbol})
        SET e.name = $name, e.atomic_number = $z,
            e.eu_crm_2023 = $eu, e.usgs_2022 = $usgs, e.supply_risk_note = $note
        """,
        symbol=symbol,
        name=name,
        z=atomic_number,
        eu=eu_crm_2023,
        usgs=usgs_2022,
        note=supply_risk_note,
    )


# ---------------------------------------------------------------------------
# Source / Chunk
# ---------------------------------------------------------------------------

def upsert_source(
    s: Session,
    *,
    source_id: str,
    title: str,
    type: str,
    url_or_doi: str | None = None,
    authors: list[str] | None = None,
    year: int | None = None,
    doi: str | None = None,
    abstract: str | None = None,
    license: str | None = None,
    openalex_id: str | None = None,
    is_oa: bool | None = None,
    oa_pdf_url: str | None = None,
    provider: str | None = None,
) -> None:
    if type not in SOURCE_TYPES:
        raise ValueError(f"Source.type must be one of {SOURCE_TYPES}, got {type!r}")
    s.run(
        """
        MERGE (src:Source {source_id: $source_id})
        ON CREATE SET src.ingested_at = $now
        SET src.title = $title, src.type = $type, src.url_or_doi = $url_or_doi,
            src.authors = $authors, src.year = $year, src.doi = $doi,
            src.abstract = coalesce($abstract, src.abstract),
            src.license = coalesce($license, src.license),
            src.openalex_id = coalesce($openalex_id, src.openalex_id),
            src.is_oa = coalesce($is_oa, src.is_oa),
            src.oa_pdf_url = coalesce($oa_pdf_url, src.oa_pdf_url),
            src.provider = coalesce($provider, src.provider)
        """,
        source_id=source_id,
        title=title,
        type=type,
        url_or_doi=url_or_doi,
        authors=authors or [],
        year=year,
        doi=doi,
        abstract=abstract,
        license=license,
        openalex_id=openalex_id,
        is_oa=is_oa,
        oa_pdf_url=oa_pdf_url,
        provider=provider,
        now=now_iso(),
    )


def set_source_embedding(s: Session, source_id: str, vector: list[float]) -> None:
    s.run(
        "MATCH (src:Source {source_id: $sid}) SET src.abstract_embedding = $vec, src.embedded_at = $now",
        sid=source_id,
        vec=vector,
        now=now_iso(),
    )


def upsert_chunks(s: Session, source_id: str, chunks: list[dict[str, Any]]) -> int:
    """chunks: [{chunk_id, text, ordinal, section?, page?, embedding?}]. Returns count written."""
    if not chunks:
        return 0
    s.run(
        """
        MATCH (src:Source {source_id: $sid})
        UNWIND $chunks AS c
        MERGE (ch:Chunk {chunk_id: c.chunk_id})
        SET ch.text = c.text, ch.ordinal = c.ordinal, ch.section = c.section, ch.page = c.page,
            ch.embedding = c.embedding, ch.source_id = $sid
        MERGE (ch)-[:PART_OF]->(src)
        """,
        sid=source_id,
        chunks=[
            {
                "chunk_id": c["chunk_id"],
                "text": c["text"],
                "ordinal": c.get("ordinal", 0),
                "section": c.get("section"),
                "page": c.get("page"),
                "embedding": c.get("embedding"),
            }
            for c in chunks
        ],
    )
    return len(chunks)


# ---------------------------------------------------------------------------
# Material and composition
# ---------------------------------------------------------------------------

def upsert_material(
    s: Session,
    *,
    material_key: str,
    formula: str,
    reduced_formula: str | None = None,
    kind: str = "crystal",
    mp_id: str | None = None,
    spacegroup: str | None = None,
    spacegroup_number: int | None = None,
    data_source: str | None = None,
    license: str | None = None,
    provider: str | None = None,
    external_ids: list[str] | None = None,
    smiles: str | None = None,
    inchikey: str | None = None,
    common_name: str | None = None,
    structure_type: str | None = None,
) -> None:
    if kind not in MATERIAL_KINDS:
        raise ValueError(f"Material.kind must be one of {MATERIAL_KINDS}, got {kind!r}")
    s.run(
        """
        MERGE (m:Material {material_key: $material_key})
        ON CREATE SET m.created_at = $now, m.external_ids = []
        SET m.formula = $formula,
            m.reduced_formula = coalesce($reduced_formula, m.reduced_formula),
            m.kind = $kind,
            m.mp_id = coalesce($mp_id, m.mp_id),
            m.spacegroup = coalesce($spacegroup, m.spacegroup),
            m.spacegroup_number = coalesce($spacegroup_number, m.spacegroup_number),
            m.data_source = coalesce($data_source, m.data_source),
            m.license = coalesce($license, m.license),
            m.provider = coalesce($provider, m.provider),
            m.smiles = coalesce($smiles, m.smiles),
            m.inchikey = coalesce($inchikey, m.inchikey),
            m.common_name = coalesce($common_name, m.common_name),
            m.structure_type = coalesce($structure_type, m.structure_type),
            m.external_ids = coalesce(m.external_ids, []) + [x IN $external_ids WHERE NOT x IN coalesce(m.external_ids, [])]
        """,
        material_key=material_key,
        formula=formula,
        reduced_formula=reduced_formula,
        kind=kind,
        mp_id=mp_id,
        spacegroup=spacegroup,
        spacegroup_number=spacegroup_number,
        data_source=data_source,
        license=license,
        provider=provider,
        smiles=smiles,
        inchikey=inchikey,
        common_name=common_name,
        structure_type=structure_type,
        external_ids=sorted(set(external_ids or [])),
        now=now_iso(),
    )


def upsert_composed_of(s: Session, material_key: str, composition: dict[str, float]) -> None:
    """(Material)-[:COMPOSED_OF {stoichiometry, fraction}]->(Element). Elements must already be seeded."""
    if not composition:
        return
    total = float(sum(composition.values())) or 1.0
    rows = [
        {"symbol": sym, "stoichiometry": float(amt), "fraction": float(amt) / total}
        for sym, amt in composition.items()
    ]
    result = s.run(
        """
        MATCH (m:Material {material_key: $k})
        UNWIND $rows AS r
        MATCH (e:Element {symbol: r.symbol})
        MERGE (m)-[c:COMPOSED_OF]->(e)
        SET c.stoichiometry = r.stoichiometry, c.fraction = r.fraction
        RETURN count(c) AS n
        """,
        k=material_key,
        rows=rows,
    ).single()
    if result is None or result["n"] != len(rows):
        missing = [r["symbol"] for r in rows]
        raise RuntimeError(
            f"COMPOSED_OF for {material_key}: wrote {result['n'] if result else 0}/{len(rows)} edges; "
            f"are all Elements seeded? ({missing})"
        )


# ---------------------------------------------------------------------------
# PropertyValue
# ---------------------------------------------------------------------------

def upsert_property_value(
    s: Session,
    *,
    material_key: str,
    property_type: str,
    value: float,
    unit: str | None,
    source_id: str,
    source_type: str,
    confidence: str | float | None,
    confirmed: bool,
    conditions: str | dict | None = "",
    extraction_method: str | None = None,
    quote: str | None = None,
) -> None:
    """Generalisation of the first loader's _set_property_value.

    Merge key: (material, property_type, source_id, conditions). Two sources
    asserting the same property for one material therefore coexist as two
    PropertyValue nodes, which is what provenance and "do sources disagree?"
    queries need.
    """
    if property_type not in PROPERTY_UNITS:
        raise ValueError(f"unknown property_type {property_type!r}; add it to graph/reference.py first")
    if source_type not in PV_SOURCE_TYPES:
        raise ValueError(f"source_type must be one of {PV_SOURCE_TYPES}, got {source_type!r}")
    cond = _conditions_str(conditions)
    result = s.run(
        """
        MATCH (m:Material {material_key: $k})
        MATCH (pt:PropertyType {name: $prop})
        MATCH (src:Source {source_id: $sid})
        MERGE (m)-[:HAS_PROPERTY]->(pv:PropertyValue {property_type: $prop, source_id: $sid, conditions: $cond})
        ON CREATE SET pv.computed_at = $now
        SET pv.value = $value, pv.unit = $unit, pv.source_type = $source_type,
            pv.confidence = $confidence, pv.confirmed = $confirmed,
            pv.extraction_method = $extraction_method, pv.quote = $quote
        MERGE (pv)-[:OF_TYPE]->(pt)
        MERGE (pv)-[:SOURCED_FROM]->(src)
        RETURN count(pv) AS n
        """,
        k=material_key,
        prop=property_type,
        sid=source_id,
        cond=cond,
        value=float(value),
        unit=unit or PROPERTY_UNITS[property_type],
        source_type=source_type,
        confidence=confidence,
        confirmed=bool(confirmed),
        extraction_method=extraction_method,
        quote=quote,
        now=now_iso(),
    ).single()
    if result is None or result["n"] == 0:
        raise RuntimeError(
            f"PropertyValue not written for {material_key}/{property_type}: "
            f"Material, PropertyType or Source {source_id!r} missing"
        )


# ---------------------------------------------------------------------------
# USED_IN / SIMILAR_TO / Gap
# ---------------------------------------------------------------------------

def upsert_used_in(
    s: Session,
    *,
    material_key: str,
    application: str,
    source_id: str,
    confirmed: bool,
    basis: str,
    quote: str | None = None,
    extraction_method: str | None = None,
) -> None:
    if basis not in USED_IN_BASES:
        raise ValueError(f"basis must be one of {USED_IN_BASES}, got {basis!r}")
    result = s.run(
        """
        MATCH (m:Material {material_key: $k})
        MATCH (a:Application {name: $app})
        MATCH (src:Source {source_id: $sid})
        MERGE (m)-[u:USED_IN {source_id: $sid}]->(a)
        ON CREATE SET u.created_at = $now
        SET u.confirmed = $confirmed, u.basis = $basis, u.quote = $quote, u.extraction_method = $em
        MERGE (a)-[:TAGGED_BY]->(src)
        RETURN count(u) AS n
        """,
        k=material_key,
        app=application,
        sid=source_id,
        confirmed=bool(confirmed),
        basis=basis,
        quote=quote,
        em=extraction_method,
        now=now_iso(),
    ).single()
    if result is None or result["n"] == 0:
        raise RuntimeError(f"USED_IN not written: Material {material_key!r}, Application {application!r} or Source {source_id!r} missing")


def upsert_similar_to(s: Session, *, from_key: str, to_key: str, method: str, score: float, confirmed: bool = False) -> None:
    s.run(
        """
        MATCH (a:Material {material_key: $a})
        MATCH (b:Material {material_key: $b})
        MERGE (a)-[r:SIMILAR_TO {method: $method}]->(b)
        SET r.score = $score, r.confirmed = $confirmed, r.computed_at = $now
        """,
        a=from_key,
        b=to_key,
        method=method,
        score=float(score),
        confirmed=bool(confirmed),
        now=now_iso(),
    )


def upsert_gap(
    s: Session,
    *,
    gap_id: str,
    description: str,
    domain: str,
    source_id: str,
    application: str | None = None,
    status: str = "open",
    extraction_method: str | None = None,
    confirmed: bool = False,
) -> None:
    result = s.run(
        """
        MATCH (d:Domain {name: $domain})
        MATCH (src:Source {source_id: $sid})
        MERGE (g:Gap {gap_id: $gap_id})
        ON CREATE SET g.identified_date = $now
        SET g.description = $description, g.status = $status, g.application = $application,
            g.extraction_method = $em, g.confirmed = $confirmed
        MERGE (d)-[:HAS_GAP]->(g)
        MERGE (g)-[:DOCUMENTED_IN]->(src)
        RETURN count(g) AS n
        """,
        domain=domain,
        sid=source_id,
        gap_id=gap_id,
        description=description,
        status=status,
        application=application,
        em=extraction_method,
        confirmed=bool(confirmed),
        now=now_iso(),
    ).single()
    if result is None or result["n"] == 0:
        raise RuntimeError(f"Gap not written: Domain {domain!r} or Source {source_id!r} missing")


# ---------------------------------------------------------------------------
# Review flips and deletes
# ---------------------------------------------------------------------------

def set_used_in_confirmed(s: Session, *, material_key: str, application: str, source_id: str, confirmed: bool) -> None:
    s.run(
        """
        MATCH (:Material {material_key: $k})-[u:USED_IN {source_id: $sid}]->(:Application {name: $app})
        SET u.confirmed = $confirmed, u.reviewed_at = $now
        """,
        k=material_key, app=application, sid=source_id, confirmed=bool(confirmed), now=now_iso(),
    )


def set_property_value_confirmed(s: Session, *, material_key: str, property_type: str, source_id: str, conditions: str | dict | None, confirmed: bool) -> None:
    s.run(
        """
        MATCH (:Material {material_key: $k})-[:HAS_PROPERTY]->(pv:PropertyValue {property_type: $p, source_id: $sid, conditions: $cond})
        SET pv.confirmed = $confirmed, pv.reviewed_at = $now
        """,
        k=material_key, p=property_type, sid=source_id, cond=_conditions_str(conditions), confirmed=bool(confirmed), now=now_iso(),
    )


def delete_used_in(s: Session, *, material_key: str, application: str, source_id: str) -> None:
    s.run(
        "MATCH (:Material {material_key: $k})-[u:USED_IN {source_id: $sid}]->(:Application {name: $app}) DELETE u",
        k=material_key, app=application, sid=source_id,
    )


def delete_property_value(s: Session, *, material_key: str, property_type: str, source_id: str, conditions: str | dict | None) -> None:
    s.run(
        """
        MATCH (:Material {material_key: $k})-[:HAS_PROPERTY]->(pv:PropertyValue {property_type: $p, source_id: $sid, conditions: $cond})
        DETACH DELETE pv
        """,
        k=material_key, p=property_type, sid=source_id, cond=_conditions_str(conditions),
    )


def reset_graph(s: Session, *, confirm: bool = False) -> None:
    """Wipe all nodes and relationships. Requires confirm=True; the dataset is regenerable."""
    if not confirm:
        raise RuntimeError("reset_graph requires confirm=True")
    s.run("MATCH (n) DETACH DELETE n")
