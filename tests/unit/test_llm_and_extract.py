import json

import pytest
from pydantic import BaseModel

from materialsgraph.harvest.extract import system_prompt, to_candidates
from materialsgraph.harvest.models import (
    CandidateGap,
    CandidatePropertyValue,
    CandidateUsedIn,
    ExtractionOutput,
    parse_candidate,
)
from materialsgraph.harvest.validate import validate_candidate
from materialsgraph.llm.local_client import StructuredOutputError, _strip_fences


class Point(BaseModel):
    x: int
    y: int


def test_structured_llm_parses_fenced_json(fake_llm):
    llm = fake_llm(['```json\n{"x": 1, "y": 2}\n```'])
    assert llm.complete(Point, "sys", "user") == Point(x=1, y=2)


def test_structured_llm_reprompts_on_invalid_then_succeeds(fake_llm):
    llm = fake_llm(['{"x": "not-an-int", "y": 2}', '{"x": 3, "y": 4}'])
    assert llm.complete(Point, "sys", "user") == Point(x=3, y=4)
    assert len(llm.calls) == 2
    assert "did not validate" in llm.calls[1][-1]["content"]


def test_structured_llm_gives_up_after_retries(fake_llm):
    llm = fake_llm(["nope", "still nope", "no"])
    with pytest.raises(StructuredOutputError):
        llm.complete(Point, "sys", "user")


def test_structured_llm_falls_back_when_json_schema_unsupported(fake_llm):
    def raw(messages, response_format, temperature):
        if response_format and response_format.get("type") == "json_schema":
            raise RuntimeError("400: response_format json_schema not supported")
        return '{"x": 9, "y": 9}'

    llm = fake_llm(raw)
    assert llm.complete(Point, "sys", "user") == Point(x=9, y=9)
    assert llm._json_schema_supported is False


def test_strip_fences_extracts_outer_object():
    assert _strip_fences('Sure! Here it is: {"a": 1} hope that helps') == '{"a": 1}'


def test_system_prompt_lists_properties_and_applications():
    p = system_prompt()
    assert "ionic_conductivity" in p and "solid electrolyte" in p and "{property_types}" not in p


def test_extraction_output_to_candidates_and_validation(fixture_json):
    out = ExtractionOutput.model_validate(fixture_json("llm_extraction_ok.json"))
    cands = to_candidates(out, source_id="doi:10.1000/example", extraction_method="lmstudio:test@v1")
    kinds = sorted(c.kind for c in cands)
    assert kinds == ["gap", "material", "property_value", "used_in"]
    assert all(c.candidate_id for c in cands)
    gap = next(c for c in cands if isinstance(c, CandidateGap))
    assert gap.gap_id.startswith("gap:")

    text = "Li3YCl6 is a promising solid electrolyte with an ionic conductivity of 0.5 mS/cm at 25 °C. Interfacial stability against lithium metal remains unresolved."
    pv = next(c for c in cands if isinstance(c, CandidatePropertyValue))
    pv = validate_candidate(pv, text)
    assert pv.validation.ok, pv.validation.checks
    assert pv.value_norm == pytest.approx(5e-4) and pv.unit_norm == "S/cm"
    assert json.loads(pv.conditions)["temperature_K"] == pytest.approx(298.15)
    assert pv.resolution.status == "new_crystal"

    ui = next(c for c in cands if isinstance(c, CandidateUsedIn))
    ui = validate_candidate(ui, text)
    assert ui.validation.ok and ui.application == "solid electrolyte"


def test_validation_fails_on_fabricated_quote_and_implausible_value():
    pv = CandidatePropertyValue(source_id="s", quote="ten siemens", formula_raw="Li3YCl6", property_type="ionic_conductivity", value=10, unit_raw="S/cm")
    pv.ensure_id()
    pv = validate_candidate(pv, "Li3YCl6 conducts 0.5 mS/cm.")
    names = {c.name: c.ok for c in pv.validation.checks}
    assert names["quote_in_text"] is False
    assert names["value_plausible"] is False
    assert pv.validation.ok is False


def test_candidate_roundtrip_through_json():
    pv = CandidatePropertyValue(source_id="s", quote="q", formula_raw="LiFePO4", property_type="voltage", value=3.4, unit_raw="V")
    pv.ensure_id()
    again = parse_candidate(json.loads(pv.model_dump_json()))
    assert isinstance(again, CandidatePropertyValue) and again.candidate_id == pv.candidate_id
