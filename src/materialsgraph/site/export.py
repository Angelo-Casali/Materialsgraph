"""Neo4j graph -> site snapshot. Never exports abstracts, chunk text or embeddings."""

from __future__ import annotations

from neo4j import Session

from materialsgraph.graph import queries
from materialsgraph.site.build import (
    add_similarity,
    build_aliases,
    composition_entries,
    git_sha,
    now_iso,
    reference_applications,
    reference_domain,
    reference_elements,
    reference_property_types,
)
from materialsgraph.site.snapshot_models import (
    SAMPLE_SOURCE_ID,
    Meta,
    Requirement,
    Similar,
    SnapGap,
    SnapMaterial,
    SnapPropertyValue,
    Snapshot,
    SnapSource,
    UsedIn,
)

REAL_NOTICE = "Exported from the MaterialsGraph knowledge graph. Each value carries its source, source type and review status."


def _requirements_from_graph(session: Session, application: str) -> list[Requirement]:
    return [
        Requirement(property_type=r["property_type"], target_min=r["target_min"], target_max=r["target_max"], importance=r["importance"] or "medium")
        for r in queries.requirements_for(session, application)
        if r.get("level") == "application"
    ]


def export_snapshot(session: Session, *, include_quotes: bool = False, max_materials: int | None = None, recompute_similar: bool = False) -> Snapshot:
    keys = [r["k"] for r in session.run("MATCH (m:Material) RETURN m.material_key AS k ORDER BY k LIMIT $n", n=max_materials or 1_000_000)]
    materials: list[SnapMaterial] = []
    used_sources: set[str] = set()
    for key in keys:
        prof = queries.material_profile(session, key)
        if prof is None:
            continue
        m = prof["material"]
        comp = {e["symbol"]: float(e["stoichiometry"] or 0) for e in prof["elements"]}
        props = []
        for p in prof["properties"]:
            if p["value"] is None:
                continue
            props.append(
                SnapPropertyValue(
                    property_type=p["property_type"], value=float(p["value"]), unit=p["unit"] or "", source_type=p["source_type"] or "literature_asserted",
                    confirmed=bool(p["confirmed"]), source_id=p["source_id"] or "unknown", conditions=p["conditions"] or "",
                    quote=None,  # quotes are exported only on request, see below
                )
            )
            used_sources.add(p["source_id"] or "unknown")
        used_in = [
            UsedIn(application=a["application"], basis=a["basis"] or "computed", confirmed=bool(a["confirmed"]), source_id=a["source_id"] or "unknown")
            for a in prof["applications"]
        ]
        used_sources.update(u.source_id for u in used_in)
        similar = [Similar(key=s["material_key"], method=s["method"] or "unknown", score=float(s["score"] or 0), confirmed=bool(s["confirmed"])) for s in prof["similar"]]
        materials.append(
            SnapMaterial(
                key=m["material_key"], formula=m["formula"] or m["material_key"], reduced_formula=m.get("reduced_formula") or m["formula"] or "",
                kind=m.get("kind") or "crystal", common_name=m.get("common_name"), spacegroup=m.get("spacegroup"), mp_id=m.get("mp_id"),
                smiles=m.get("smiles"), inchikey=m.get("inchikey"), license=m.get("license"),
                composition=composition_entries(comp), properties=props, used_in=used_in, similar=similar,
            )
        )
    if include_quotes:
        quotes = {
            (r["k"], r["p"], r["sid"], r["c"]): r["q"]
            for r in session.run(
                "MATCH (m:Material)-[:HAS_PROPERTY]->(pv:PropertyValue) WHERE pv.quote IS NOT NULL "
                "RETURN m.material_key AS k, pv.property_type AS p, pv.source_id AS sid, pv.conditions AS c, pv.quote AS q"
            )
        }
        for m in materials:
            for p in m.properties:
                p.quote = quotes.get((m.key, p.property_type, p.source_id, p.conditions))
    if recompute_similar:
        for m in materials:
            m.similar = []
        add_similarity(materials)

    gaps = [
        SnapGap(gap_id=g["gap_id"], description=g["description"], application=g.get("application"), status=g.get("status") or "open",
                confirmed=bool(g.get("confirmed")), source_id=g["source_id"])
        for g in queries.gaps_for(session, None, limit=10_000)
    ]
    used_sources.update(g.source_id for g in gaps)

    sources = []
    for r in session.run(
        "UNWIND $ids AS id MATCH (s:Source {source_id: id}) "
        "RETURN s.source_id AS sid, s.title AS title, s.type AS type, s.year AS year, s.doi AS doi, s.url_or_doi AS url, s.license AS license",
        ids=sorted(used_sources),
    ):
        sources.append(
            SnapSource(source_id=r["sid"], title=r["title"] or r["sid"], type=r["type"] or "paper", year=r["year"], doi=r["doi"],
                       url=r["url"], license=r["license"], citable=r["sid"] != SAMPLE_SOURCE_ID)
        )

    apps = reference_applications()
    for app in apps:
        graph_reqs = _requirements_from_graph(session, app.name)
        if graph_reqs:
            app.requires = graph_reqs  # reviewer-edited targets in the graph win over reference defaults

    is_sample = bool(materials) and all(m.key.startswith("sample:") for m in materials)
    snap = Snapshot(
        meta=Meta(generated_at=now_iso(), generator="materialsgraph.site.export_snapshot", git_sha=git_sha(), sample=is_sample,
                  notice=REAL_NOTICE if not is_sample else "Illustrative sample loaded into Neo4j and re-exported. Not for citation."),
        domain=reference_domain(),
        property_types=reference_property_types(),
        applications=apps,
        elements=reference_elements({c.symbol for m in materials for c in m.composition}),
        sources=sources,
        materials=materials,
        gaps=gaps,
        aliases=build_aliases(materials),
    )
    snap.recount()
    return snap
