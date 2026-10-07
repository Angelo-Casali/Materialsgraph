"""Local-LLM extraction of candidates from one source text (abstract or chunk)."""

from __future__ import annotations

import json
from pathlib import Path

from materialsgraph.graph.reference import APPLICATIONS, PROPERTY_UNITS
from materialsgraph.harvest.models import (
    Candidate,
    CandidateGap,
    CandidateMaterial,
    CandidatePropertyValue,
    CandidateUsedIn,
    ExtractionOutput,
    SourceRecord,
    TextChunk,
)
from materialsgraph.harvest.units import parse_conditions
from materialsgraph.llm.local_client import StructuredLLM, StructuredOutputError

PROMPT_VERSION = "v1"
PROMPT_PATH = Path(__file__).parent / "prompts" / f"extract_{PROMPT_VERSION}.md"


def system_prompt() -> str:
    template = PROMPT_PATH.read_text()
    return template.replace("{property_types}", ", ".join(sorted(PROPERTY_UNITS))).replace(
        "{applications}", "; ".join(APPLICATIONS)
    )


def to_candidates(output: ExtractionOutput, *, source_id: str, extraction_method: str, chunk_id: str | None = None) -> list[Candidate]:
    cands: list[Candidate] = []
    for m in output.materials:
        cands.append(
            CandidateMaterial(
                source_id=source_id, quote="", extraction_method=extraction_method, chunk_id=chunk_id,
                formula_raw=m.formula, material_kind=m.material_kind, common_name=m.common_name,
            )
        )
    for pv in output.property_values:
        if pv.property_type not in PROPERTY_UNITS:
            continue  # the validator would reject it anyway; drop early
        conditions = parse_conditions(pv.conditions)
        cands.append(
            CandidatePropertyValue(
                source_id=source_id, quote=pv.quote, extraction_method=extraction_method, chunk_id=chunk_id,
                llm_confidence=pv.confidence, formula_raw=pv.formula, property_type=pv.property_type,
                value=pv.value, unit_raw=pv.unit, conditions=json.dumps(conditions, sort_keys=True) if conditions else "",
                source_type=pv.source_type,
            )
        )
    for u in output.used_in:
        cands.append(
            CandidateUsedIn(
                source_id=source_id, quote=u.quote, extraction_method=extraction_method, chunk_id=chunk_id,
                llm_confidence=u.confidence, formula_raw=u.formula, application_raw=u.application,
            )
        )
    for g in output.gaps:
        cands.append(
            CandidateGap(
                source_id=source_id, quote=g.quote, extraction_method=extraction_method, chunk_id=chunk_id,
                llm_confidence=g.confidence, description=g.description, application=g.application,
            )
        )
    for c in cands:
        c.ensure_id()
    return cands


def extract_text(llm: StructuredLLM, text: str, *, source_id: str, chunk_id: str | None = None) -> list[Candidate]:
    method = f"lmstudio:{llm.model}@{PROMPT_VERSION}"
    try:
        output = llm.complete(ExtractionOutput, system_prompt(), text)
    except StructuredOutputError as exc:
        print(f"  extraction failed for {source_id}: {exc}")
        return []
    return to_candidates(output, source_id=source_id, extraction_method=method, chunk_id=chunk_id)


def extract_from_source(llm: StructuredLLM, record: SourceRecord) -> list[Candidate]:
    text = record.text_for_extraction()
    if len(text) < 80:
        return []
    return extract_text(llm, text, source_id=record.source_id)


def extract_from_chunks(llm: StructuredLLM, chunks: list[TextChunk]) -> list[Candidate]:
    out: list[Candidate] = []
    for ch in chunks:
        out.extend(extract_text(llm, ch.text, source_id=ch.source_id, chunk_id=ch.chunk_id))
    return out
