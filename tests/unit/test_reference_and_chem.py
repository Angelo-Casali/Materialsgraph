import pytest

from materialsgraph import chem
from materialsgraph.graph.reference import (
    APPLICATIONS,
    PROPERTY_PLAUSIBLE,
    PROPERTY_UNITS,
    critical_flags,
    insertion_electrode_application,
    resolve_application_name,
)


def test_every_application_requirement_names_a_known_property():
    for name, spec in APPLICATIONS.items():
        for req in spec["requires"]:
            assert req["property_type"] in PROPERTY_UNITS, (name, req)


def test_plausible_ranges_cover_every_property():
    assert set(PROPERTY_PLAUSIBLE) == set(PROPERTY_UNITS)
    for lo, hi in PROPERTY_PLAUSIBLE.values():
        assert lo < hi


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("solid electrolyte", "solid electrolyte"),
        ("Solid-State Electrolyte", "solid electrolyte"),
        ("garnet-type solid electrolyte", "solid electrolyte"),
        ("cathode", "Li-ion cathode"),
        ("sodium-ion cathode", "Na-ion cathode"),
        ("SEI-forming additive", "electrolyte additive"),
        ("lithium salt", "electrolyte salt"),
        ("Li-ion insertion electrode", insertion_electrode_application("Li")),
        ("thermal paste", None),
        ("", None),
        (None, None),
    ],
)
def test_resolve_application_name(raw, expected):
    assert resolve_application_name(raw) == expected


def test_critical_flags():
    assert critical_flags("Co") == {"eu_crm_2023": True, "usgs_2022": True, "supply_risk_note": "EU strategic"}
    assert critical_flags("Fe")["eu_crm_2023"] is False


def test_reduced_formula_canonicalises_optimade_ordering():
    assert chem.reduced_formula("FeLiO4P") == "LiFePO4"
    assert chem.reduced_formula("Li7La3Zr2O12") == "Li7La3Zr2O12"
    assert chem.reduced_formula("Li2Co2O4") == "LiCoO2"


def test_parse_composition_and_clean():
    comp = chem.parse_composition("LiFePO₄ (LFP)")
    assert comp == {"Li": 1.0, "Fe": 1.0, "P": 1.0, "O": 4.0}
    assert chem.clean_formula("Li 7 La3Zr2O12") == "Li7La3Zr2O12"


@pytest.mark.parametrize("raw", ["Li1-xNi0.8Co0.2O2", "LiNixMn1-xO2", "Li7La3Zr2O12-δ", "Li(1-x)FePO4"])
def test_has_variable(raw):
    assert chem.has_variable(raw)


def test_no_variable_on_concrete_formula():
    assert not chem.has_variable("LiNi0.8Mn0.1Co0.1O2")
    assert not chem.has_variable("Li6PS5Cl")


def test_unparseable_raises():
    with pytest.raises(chem.FormulaError):
        chem.parse_composition("not a formula !!")
