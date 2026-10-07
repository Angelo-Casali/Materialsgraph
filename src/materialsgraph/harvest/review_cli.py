"""Interactive human review of a harvest queue (stdlib only).

Keys: a=accept  r=reject  e=edit  s=skip  q=quit.
There is deliberately no auto-accept: CLAUDE.md requires a human before any
AI-suggested edge becomes confirmed.
"""

from __future__ import annotations

import json
import textwrap

from materialsgraph.harvest.models import (
    Candidate,
    CandidateGap,
    CandidateMaterial,
    CandidatePropertyValue,
    CandidateUsedIn,
    ReviewDecision,
    SourceRecord,
)
from materialsgraph.harvest.stage import read_queue, read_sources, write_queue


def _wrap(text: str, indent: str = "    ") -> str:
    return textwrap.fill(text or "", width=96, initial_indent=indent, subsequent_indent=indent)


def render(c: Candidate, sources: dict[str, SourceRecord]) -> str:
    src = sources.get(c.source_id)
    lines = [f"[{c.kind}] {c.candidate_id}  status={c.status}  llm_conf={c.llm_confidence}"]
    if src:
        lines.append(f"  source: {src.title} ({src.year}) {src.url_or_doi}")
    else:
        lines.append(f"  source: {c.source_id}")
    if isinstance(c, CandidatePropertyValue):
        norm = f" -> {c.value_norm:g} {c.unit_norm}" if c.value_norm is not None else ""
        lines.append(f"  {c.formula_raw}: {c.property_type} = {c.value} {c.unit_raw}{norm}  [{c.source_type}] conditions={c.conditions or '-'}")
    elif isinstance(c, CandidateUsedIn):
        lines.append(f"  {c.formula_raw} USED_IN {c.application_raw!r} -> {c.application or 'UNRESOLVED'}")
    elif isinstance(c, CandidateGap):
        lines.append(f"  gap ({c.application or 'domain-level'}): {c.description}")
    elif isinstance(c, CandidateMaterial):
        lines.append(f"  material {c.formula_raw} kind={c.material_kind} name={c.common_name or '-'}")
    if c.quote:
        lines.append("  quote:")
        lines.append(_wrap(f'"{c.quote}"'))
    if c.resolution:
        lines.append(f"  resolution: {c.resolution.status} -> {c.resolution.material_key}" + (f" (parent {c.resolution.parent_material_key})" if c.resolution.parent_material_key else ""))
        if c.resolution.candidates:
            lines.append(f"    alternatives: {', '.join(c.resolution.candidates)}")
    if c.validation:
        flag = "OK " if c.validation.ok else "FAIL"
        lines.append(f"  validation: {flag}")
        for ch in c.validation.checks:
            mark = "+" if ch.ok else "-"
            lines.append(f"    {mark} {ch.name}" + (f": {ch.detail}" if ch.detail else ""))
        if c.validation.cloud_verdict:
            lines.append(f"    cloud: {c.validation.cloud_verdict} {c.validation.cloud_note or ''}")
    return "\n".join(lines)


def _edit(c: Candidate, input_fn=input) -> dict:
    """Prompt for field edits; empty keeps the current value."""
    editable = {
        CandidatePropertyValue: ["formula_raw", "property_type", "value", "unit_raw", "conditions", "source_type"],
        CandidateUsedIn: ["formula_raw", "application"],
        CandidateGap: ["description", "application"],
        CandidateMaterial: ["formula_raw", "material_kind", "common_name"],
    }[type(c)]
    edits: dict = {}
    for field in editable:
        cur = getattr(c, field)
        new = input_fn(f"    {field} [{cur}]: ").strip()
        if new:
            if field == "value":
                new = float(new)
            setattr(c, field, new)
            edits[field] = new
    key = input_fn(f"    material_key override [{c.resolution.material_key if c.resolution else '-'}]: ").strip()
    if key and c.resolution:
        c.resolution.material_key = key
        c.resolution.status = "matched"
        edits["material_key"] = key
    return edits


def review_batch(batch_id: str, *, only_kind: str | None = None, only_status: str = "pending", input_fn=input, print_fn=print) -> dict:
    cands = read_queue(batch_id)
    sources = {s.source_id: s for s in read_sources(batch_id)}
    todo = [c for c in cands if (only_kind is None or c.kind == only_kind) and (only_status is None or c.status == only_status)]
    print_fn(f"{len(todo)} candidates to review in {batch_id} (a=accept r=reject e=edit s=skip q=quit)")
    counts = {"accepted": 0, "rejected": 0, "needs_edit": 0, "skipped": 0}
    for i, c in enumerate(todo, start=1):
        print_fn("\n" + "=" * 96)
        print_fn(f"({i}/{len(todo)})")
        print_fn(render(c, sources))
        while True:
            key = input_fn("> ").strip().lower()[:1]
            if key == "a":
                c.status = "accepted"
                c.review = ReviewDecision(status="accepted")
                counts["accepted"] += 1
                break
            if key == "r":
                note = input_fn("    reason (optional): ").strip() or None
                c.status = "rejected"
                c.review = ReviewDecision(status="rejected", note=note)
                counts["rejected"] += 1
                break
            if key == "e":
                edits = _edit(c, input_fn)
                c.status = "accepted"
                c.review = ReviewDecision(status="accepted", edits=edits, note="edited by reviewer")
                counts["accepted"] += 1
                break
            if key == "s":
                counts["skipped"] += 1
                break
            if key == "q":
                write_queue(batch_id, cands)
                print_fn(json.dumps(counts))
                return counts
            print_fn("    a / r / e / s / q")
        write_queue(batch_id, cands)  # save after every decision
    print_fn(json.dumps(counts))
    return counts
