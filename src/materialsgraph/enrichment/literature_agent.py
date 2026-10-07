"""RAG enrichment -> USED_IN, PropertyValue, Gap candidates (local LLM), behind a human review gate.

Pipeline (plain function sequence; graph-ify with LangGraph only if retries or
branching ever need it):

    discover -> [fulltext] -> extract -> validate -> stage (JSONL queue)
    ... human review (harvest/review_cli.py) ...
    commit (harvest/commit.py) -> Neo4j, confirmed=true only for accepted

Nothing in this module writes to Neo4j.
"""

from __future__ import annotations

from materialsgraph.harvest.discover import discover, make_connectors
from materialsgraph.harvest.extract import extract_from_chunks, extract_from_source
from materialsgraph.harvest.fulltext import fulltext_chunks
from materialsgraph.harvest.models import Candidate, SourceRecord, TextChunk
from materialsgraph.harvest.stage import queue_stats, read_chunks, read_sources, write_chunks, write_queue
from materialsgraph.harvest.validate import validate_all
from materialsgraph.llm.local_client import StructuredLLM


def fetch_fulltext(batch_id: str, records: list[SourceRecord] | None = None, *, max_docs: int | None = None) -> list[TextChunk]:
    records = records or read_sources(batch_id)
    chunks: list[TextChunk] = []
    n_docs = 0
    for r in records:
        if max_docs is not None and n_docs >= max_docs:
            break
        got = fulltext_chunks(r)
        if got:
            n_docs += 1
            chunks.extend(got)
            print(f"  {r.source_id}: {len(got)} chunks ({r.license})")
    write_chunks(batch_id, chunks)
    print(f"{n_docs} open-access documents -> {len(chunks)} chunks")
    return chunks


def extract_batch(batch_id: str, llm: StructuredLLM, *, max_sources: int | None = None, use_chunks: bool = True) -> list[Candidate]:
    records = read_sources(batch_id)
    if max_sources is not None:
        records = records[:max_sources]
    chunks_by_source: dict[str, list[TextChunk]] = {}
    if use_chunks:
        for ch in read_chunks(batch_id):
            chunks_by_source.setdefault(ch.source_id, []).append(ch)
    cands: list[Candidate] = []
    for i, r in enumerate(records, start=1):
        got = extract_from_source(llm, r)
        if r.source_id in chunks_by_source:
            got.extend(extract_from_chunks(llm, chunks_by_source[r.source_id]))
        print(f"  [{i}/{len(records)}] {r.source_id}: {len(got)} candidates")
        cands.extend(got)
    cands = _dedupe(cands)
    write_queue(batch_id, cands)
    print(queue_stats(cands))
    return cands


def validate_batch(batch_id: str, session=None, *, cloud: bool = False) -> list[Candidate]:
    from materialsgraph.harvest.stage import read_queue

    cands = read_queue(batch_id)
    texts = {r.source_id: r.text_for_extraction() for r in read_sources(batch_id)}
    texts.update({ch.chunk_id: ch.text for ch in read_chunks(batch_id)})
    cands = validate_all(cands, texts, session)
    if cloud:
        from materialsgraph.harvest.validate import apply_cloud_verdicts
        from materialsgraph.llm.cloud_client import validate_candidates

        to_check = [c for c in cands if c.validation and c.validation.ok and c.kind != "material"]
        verdicts = validate_candidates([c.model_dump() for c in to_check], texts)
        apply_cloud_verdicts(cands, verdicts)
    write_queue(batch_id, cands)
    print(queue_stats(cands))
    return cands


def _dedupe(cands: list[Candidate]) -> list[Candidate]:
    seen: set[str] = set()
    out = []
    for c in cands:
        if c.candidate_id in seen:
            continue
        seen.add(c.candidate_id)
        out.append(c)
    return out


def run_harvest(
    keywords: list[str] | None,
    *,
    connectors: list[str] | None = None,
    since_year: int | None = None,
    limit: int = 50,
    fulltext: bool = False,
    max_sources: int | None = None,
    session=None,
    cloud_validate: bool = False,
    llm: StructuredLLM | None = None,
) -> str:
    """End-to-end: discover -> (fulltext) -> extract -> validate -> stage. Returns the batch id."""
    batch_id, records = discover(
        keywords, connectors=make_connectors(connectors or ["openalex"]), since_year=since_year,
        limit_per_query=limit, unpaywall=fulltext,
    )
    if fulltext:
        fetch_fulltext(batch_id, records)
    extract_batch(batch_id, llm or StructuredLLM(), max_sources=max_sources, use_chunks=fulltext)
    validate_batch(batch_id, session, cloud=cloud_validate)
    print(f"batch {batch_id} staged; run `mg harvest review --batch {batch_id}` next")
    return batch_id
