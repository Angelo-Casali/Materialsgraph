"""Site snapshot -> Neo4j, through graph/writers.py only. Used to seed AuraDB Free for the live demo."""

from __future__ import annotations

from neo4j import Session

from materialsgraph.graph import writers
from materialsgraph.graph.reference import DOMAIN_NAME
from materialsgraph.ingestion import schema_loader
from materialsgraph.site.snapshot_models import SAMPLE_KEY_PREFIX, Snapshot

# AuraDB Free caps (verify in the Aura console; they have changed before)
AURA_FREE_MAX_NODES = 50_000
AURA_FREE_MAX_RELS = 175_000


class ImportRefused(RuntimeError):
    pass


def estimate_size(snap: Snapshot) -> tuple[int, int]:
    """Rough node / relationship counts the import will add (excluding reference data)."""
    nodes = len(snap.materials) + len(snap.sources) + len(snap.gaps) + sum(len(m.properties) for m in snap.materials)
    rels = sum(len(m.composition) + 3 * len(m.properties) + 2 * len(m.used_in) + len(m.similar) for m in snap.materials) + 2 * len(snap.gaps)
    return nodes, rels


def import_snapshot(session: Session, snap: Snapshot, *, force: bool = False, seed_elements: bool = True) -> dict[str, int]:
    nodes, rels = estimate_size(snap)
    if nodes > AURA_FREE_MAX_NODES * 0.9 or rels > AURA_FREE_MAX_RELS * 0.9:
        if not force:
            raise ImportRefused(f"snapshot needs ~{nodes} nodes / ~{rels} relationships, close to the AuraDB Free caps; pass force=True to try anyway")
    if snap.meta.sample and not force:
        real = session.run(
            "MATCH (m:Material) WHERE NOT m.material_key STARTS WITH $p RETURN count(m) AS n", p=SAMPLE_KEY_PREFIX
        ).single()["n"]
        if real:
            raise ImportRefused(f"graph already holds {real} real materials; refusing to mix the illustrative sample in (use force=True)")

    schema_loader.apply_schema(session)
    schema_loader.seed_reference_data(session, with_elements=seed_elements)

    counts = {"sources": 0, "materials": 0, "property_values": 0, "used_in": 0, "similar": 0, "gaps": 0}
    for src in snap.sources:
        writers.upsert_source(session, source_id=src.source_id, title=src.title, type=src.type, url_or_doi=src.url or (f"https://doi.org/{src.doi}" if src.doi else None),
                              year=src.year, doi=src.doi, license=src.license, provider="snapshot")
        counts["sources"] += 1
    for m in snap.materials:
        writers.upsert_material(
            session, material_key=m.key, formula=m.formula, reduced_formula=m.reduced_formula, kind=m.kind, mp_id=m.mp_id,
            spacegroup=m.spacegroup, structure_type=m.structure_type, smiles=m.smiles, inchikey=m.inchikey,
            common_name=m.common_name, license=m.license, data_source="snapshot", provider="snapshot",
        )
        if m.composition:
            writers.upsert_composed_of(session, m.key, {c.symbol: c.stoichiometry for c in m.composition})
        counts["materials"] += 1
    for m in snap.materials:
        for p in m.properties:
            writers.upsert_property_value(
                session, material_key=m.key, property_type=p.property_type, value=p.value, unit=p.unit, source_id=p.source_id,
                source_type=p.source_type, confidence=None, confirmed=p.confirmed, conditions=p.conditions,
                extraction_method=p.extraction_method, quote=p.quote,
            )
            counts["property_values"] += 1
        for u in m.used_in:
            writers.upsert_used_in(session, material_key=m.key, application=u.application, source_id=u.source_id, confirmed=u.confirmed, basis=u.basis)
            counts["used_in"] += 1
        for sim in m.similar:
            writers.upsert_similar_to(session, from_key=m.key, to_key=sim.key, method=sim.method, score=sim.score, confirmed=sim.confirmed)
            counts["similar"] += 1
    for g in snap.gaps:
        writers.upsert_gap(session, gap_id=g.gap_id, description=g.description, domain=DOMAIN_NAME, source_id=g.source_id,
                           application=g.application, status=g.status, confirmed=g.confirmed)
        counts["gaps"] += 1
    return counts
