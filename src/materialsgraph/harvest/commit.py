"""Turn reviewed candidates into graph writes.

- accepted            -> written with confirmed=True
- pending (opt-in)    -> used_in / property_value written with confirmed=False,
                         only when the target material already exists; material
                         and gap candidates are never created while pending
- rejected            -> if previously written as pending, the edge/value is removed

Accepted candidates are mirrored to curated/<batch>.accepted.jsonl.
"""

from __future__ import annotations

from neo4j import Session

from materialsgraph.graph import writers
from materialsgraph.graph.reference import APPLICATIONS, DOMAIN_NAME
from materialsgraph.harvest.models import (
    Candidate,
    CandidateGap,
    CandidateMaterial,
    CandidatePropertyValue,
    CandidateUsedIn,
    SourceRecord,
    TextChunk,
)
from materialsgraph.harvest.stage import append_curated, read_chunks, read_queue, read_sources, write_queue


def upsert_sources(session: Session, records: list[SourceRecord]) -> int:
    for r in records:
        writers.upsert_source(
            session,
            source_id=r.source_id, title=r.title, type=r.type, url_or_doi=r.url_or_doi, authors=r.authors,
            year=r.year, doi=r.doi, abstract=r.abstract, license=r.license, openalex_id=r.openalex_id,
            is_oa=r.is_oa, oa_pdf_url=r.oa_pdf_url, provider=r.provider,
        )
    return len(records)


def upsert_chunks(session: Session, chunks: list[TextChunk]) -> int:
    by_source: dict[str, list[dict]] = {}
    for ch in chunks:
        by_source.setdefault(ch.source_id, []).append(ch.model_dump())
    n = 0
    for sid, rows in by_source.items():
        n += writers.upsert_chunks(session, sid, rows)
    return n


def _material_exists(session: Session, key: str) -> bool:
    return session.run("MATCH (m:Material {material_key: $k}) RETURN count(m) AS n", k=key).single()["n"] > 0


def _ensure_material(session: Session, c: Candidate) -> str | None:
    """Create the resolved material if it does not exist yet (accepted candidates only). Returns material_key."""
    res = c.resolution
    if res is None or res.material_key is None:
        return None
    if _material_exists(session, res.material_key):
        return res.material_key
    if res.kind == "molecule":
        writers.upsert_material(
            session, material_key=res.material_key, formula=res.reduced_formula or getattr(c, "formula_raw", res.common_name or "?"),
            reduced_formula=res.reduced_formula, kind="molecule", inchikey=res.inchikey, smiles=res.smiles,
            common_name=res.common_name, data_source="literature", provider="harvest",
        )
    else:
        writers.upsert_material(
            session, material_key=res.material_key, formula=res.reduced_formula or getattr(c, "formula_raw", "?"),
            reduced_formula=res.reduced_formula, kind="crystal", data_source="literature", provider="harvest",
        )
    if res.composition:
        try:
            writers.upsert_composed_of(session, res.material_key, res.composition)
        except RuntimeError as exc:
            print(f"  {exc}")
    if res.status == "doped_variant" and res.parent_material_key:
        writers.upsert_similar_to(session, from_key=res.material_key, to_key=res.parent_material_key, method="doped_variant_of", score=res.parent_score or 0.0, confirmed=False)
    return res.material_key


def _write(session: Session, c: Candidate, *, confirmed: bool) -> bool:
    if isinstance(c, CandidateMaterial):
        if not confirmed:
            return False
        return _ensure_material(session, c) is not None

    if isinstance(c, CandidatePropertyValue):
        if c.value_norm is None or c.unit_norm is None:
            return False
        key = _ensure_material(session, c) if confirmed else (c.resolution.material_key if c.resolution and c.resolution.material_key and _material_exists(session, c.resolution.material_key) else None)
        if key is None:
            return False
        writers.upsert_property_value(
            session, material_key=key, property_type=c.property_type, value=c.value_norm, unit=c.unit_norm,
            source_id=c.source_id, source_type=c.source_type, confidence=c.llm_confidence, confirmed=confirmed,
            conditions=c.conditions, extraction_method=c.extraction_method, quote=c.quote,
        )
        return True

    if isinstance(c, CandidateUsedIn):
        if not c.application or c.application not in APPLICATIONS:
            return False
        key = _ensure_material(session, c) if confirmed else (c.resolution.material_key if c.resolution and c.resolution.material_key and _material_exists(session, c.resolution.material_key) else None)
        if key is None:
            return False
        writers.upsert_used_in(
            session, material_key=key, application=c.application, source_id=c.source_id, confirmed=confirmed,
            basis="literature", quote=c.quote, extraction_method=c.extraction_method,
        )
        return True

    if isinstance(c, CandidateGap):
        if not confirmed:
            return False
        writers.upsert_gap(
            session, gap_id=c.gap_id, description=c.description, domain=c.domain or DOMAIN_NAME, source_id=c.source_id,
            application=c.application, extraction_method=c.extraction_method, confirmed=True,
        )
        return True
    return False


def _remove(session: Session, c: Candidate) -> None:
    if not c.resolution or not c.resolution.material_key:
        return
    if isinstance(c, CandidatePropertyValue):
        writers.delete_property_value(session, material_key=c.resolution.material_key, property_type=c.property_type, source_id=c.source_id, conditions=c.conditions)
    elif isinstance(c, CandidateUsedIn) and c.application:
        writers.delete_used_in(session, material_key=c.resolution.material_key, application=c.application, source_id=c.source_id)


def commit_batch(session: Session, batch_id: str, *, include_pending: bool = False) -> dict:
    cands = read_queue(batch_id)
    sources = read_sources(batch_id)
    counts = {"sources": 0, "chunks": 0, "accepted_written": 0, "pending_written": 0, "removed": 0, "skipped": 0}

    needed = {c.source_id for c in cands if c.status == "accepted" or (include_pending and c.status == "pending")}
    counts["sources"] = upsert_sources(session, [s for s in sources if s.source_id in needed])
    chunks = [ch for ch in read_chunks(batch_id) if ch.source_id in needed]
    counts["chunks"] = upsert_chunks(session, chunks)

    # materials first so values/tags can attach to them
    order = {"material": 0, "property_value": 1, "used_in": 1, "gap": 2}
    for c in sorted(cands, key=lambda c: order[c.kind]):
        try:
            if c.status == "accepted":
                if _write(session, c, confirmed=True):
                    c.written = True
                    counts["accepted_written"] += 1
                else:
                    counts["skipped"] += 1
            elif c.status == "pending" and include_pending and c.validation and c.validation.ok:
                if _write(session, c, confirmed=False):
                    c.written = True
                    counts["pending_written"] += 1
                else:
                    counts["skipped"] += 1
            elif c.status == "rejected" and c.written:
                _remove(session, c)
                c.written = False
                counts["removed"] += 1
            else:
                counts["skipped"] += 1
        except Exception as exc:
            counts["skipped"] += 1
            print(f"  {c.candidate_id} ({c.kind}): {exc}")

    write_queue(batch_id, cands)
    accepted = [c for c in cands if c.status == "accepted" and c.written]
    if accepted:
        append_curated(batch_id, accepted)
    return counts
