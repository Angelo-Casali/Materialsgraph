"""Deterministic validation of extracted candidates (plus an optional Claude pass).

Checks are cheap and explainable; each one becomes a Check row the reviewer
sees. A candidate with ok=False is still kept in the queue -- the human may
fix it -- but commit.py never writes it unless accepted.
"""

from __future__ import annotations

from materialsgraph.graph.reference import PROPERTY_PLAUSIBLE, PROPERTY_UNITS, resolve_application_name
from materialsgraph.harvest.models import (
    Candidate,
    CandidateGap,
    CandidateMaterial,
    CandidatePropertyValue,
    CandidateUsedIn,
    Check,
    ValidationResult,
    normalize_ws,
)
from materialsgraph.harvest.resolve import resolve_formula
from materialsgraph.harvest.units import normalize_value


def quote_in_text(quote: str, text: str) -> bool:
    q = normalize_ws(quote)
    if len(q) < 5:
        return False
    return q in normalize_ws(text)


def validate_candidate(cand: Candidate, text: str, session=None) -> Candidate:
    checks: list[Check] = []

    if not isinstance(cand, CandidateMaterial):
        ok = quote_in_text(cand.quote, text)
        checks.append(Check(name="quote_in_text", ok=ok, detail=None if ok else "quote not found verbatim in source text"))

    if isinstance(cand, (CandidateMaterial, CandidatePropertyValue, CandidateUsedIn)):
        res = resolve_formula(cand.formula_raw, session)
        cand.resolution = res
        ok = res.status in {"matched", "ambiguous", "new_crystal", "new_molecule", "doped_variant"}
        checks.append(Check(name="formula_resolves", ok=ok, detail=f"{res.status}: {res.material_key or res.note}"))
        if isinstance(cand, CandidateMaterial) and cand.material_kind == "molecule" and res.kind != "molecule":
            checks.append(Check(name="molecule_known", ok=False, detail="molecule not in alias table; add to harvest/aliases.py or PubChem lookup"))

    if isinstance(cand, CandidatePropertyValue):
        in_ref = cand.property_type in PROPERTY_UNITS
        checks.append(Check(name="property_in_reference", ok=in_ref, detail=None if in_ref else f"unknown property {cand.property_type}"))
        norm = normalize_value(cand.value, cand.unit_raw, cand.property_type) if in_ref else None
        if norm is None:
            checks.append(Check(name="unit_normalizable", ok=False, detail=f"unknown unit {cand.unit_raw!r} for {cand.property_type}"))
        else:
            cand.value_norm, cand.unit_norm = norm
            checks.append(Check(name="unit_normalizable", ok=True, detail=f"{cand.value} {cand.unit_raw} -> {norm[0]:g} {norm[1]}"))
            lo, hi = PROPERTY_PLAUSIBLE.get(cand.property_type, (float("-inf"), float("inf")))
            plausible = lo <= norm[0] <= hi
            checks.append(Check(name="value_plausible", ok=plausible, detail=None if plausible else f"{norm[0]:g} {norm[1]} outside [{lo:g}, {hi:g}]"))

    if isinstance(cand, CandidateUsedIn):
        app = resolve_application_name(cand.application_raw)
        cand.application = app
        checks.append(Check(name="application_resolves", ok=app is not None, detail=app or f"no Application matches {cand.application_raw!r}"))

    if isinstance(cand, CandidateGap):
        long_enough = len(cand.description.split()) >= 5
        checks.append(Check(name="description_informative", ok=long_enough, detail=None if long_enough else "description too short"))
        if cand.application:
            cand.application = resolve_application_name(cand.application)

    cand.validation = ValidationResult(ok=all(c.ok for c in checks), checks=checks)
    return cand


def validate_all(cands: list[Candidate], texts: dict[str, str], session=None) -> list[Candidate]:
    return [validate_candidate(c, texts.get(c.chunk_id or "", "") or texts.get(c.source_id, ""), session) for c in cands]


def apply_cloud_verdicts(cands: list[Candidate], verdicts: list) -> None:
    by_id = {v.candidate_id: v for v in verdicts}
    for c in cands:
        v = by_id.get(c.candidate_id)
        if v and c.validation is not None:
            c.validation.cloud_verdict = v.verdict
            c.validation.cloud_note = v.note
            if v.verdict == "unsupported":
                c.validation.ok = False
                c.validation.checks.append(Check(name="cloud_validation", ok=False, detail=v.note))
