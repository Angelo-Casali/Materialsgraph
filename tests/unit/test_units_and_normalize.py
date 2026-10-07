import pytest

from materialsgraph.harvest.models import SourceRecord
from materialsgraph.harvest.normalize import dedupe_sources, normalize_doi, source_id_for, year_from
from materialsgraph.harvest.units import normalize_value, parse_conditions


@pytest.mark.parametrize(
    "value,unit,prop,expected",
    [
        (0.5, "mS/cm", "ionic_conductivity", 5e-4),
        (1.2, "S cm-1", "ionic_conductivity", 1.2),
        (1.2, "S·cm⁻¹", "ionic_conductivity", 1.2),
        (3.0, "S/m", "ionic_conductivity", 0.03),
        (25, "µS/cm", "ionic_conductivity", 2.5e-5),
        (170, "mAh g-1", "specific_capacity", 170),
        (0.17, "Ah/g", "specific_capacity", 170),
        (3.4, "V vs Li/Li+", "voltage", 3.4),
        (3400, "mV", "voltage", 3.4),
        (25, "°C", "melting_point", 298.15),
        (36.6, "", "dielectric_constant", 36.6),
        (1.9, "cP", "viscosity", 1.9),
        (0.3, "eV", "activation_energy", 0.3),
    ],
)
def test_normalize_value(value, unit, prop, expected):
    out = normalize_value(value, unit, prop)
    assert out is not None
    assert out[0] == pytest.approx(expected, rel=1e-6)


def test_unknown_unit_returns_none():
    assert normalize_value(1.0, "Wh/kg", "specific_capacity") is None
    assert normalize_value(1.0, "furlongs", "ionic_conductivity") is None
    assert normalize_value(1.0, "eV", "not_a_property") is None


def test_parse_conditions():
    assert parse_conditions("25 °C")["temperature_K"] == pytest.approx(298.15)
    assert parse_conditions("at 333 K")["temperature_K"] == 333.0
    assert parse_conditions("room temperature")["temperature_K"] == 298.0
    assert parse_conditions("") == {}


def test_normalize_doi():
    assert normalize_doi("https://doi.org/10.1088/2752-5724/AE5120") == "10.1088/2752-5724/ae5120"
    assert normalize_doi("doi:10.1002/adma.202513255.") == "10.1002/adma.202513255"
    assert normalize_doi("no doi here") is None
    assert normalize_doi(None) is None


def test_source_id_priority():
    assert source_id_for(doi="10.1/x", openalex_id="W1") == "doi:10.1/x"
    assert source_id_for(doi=None, arxiv_id="2501.01234", openalex_id="W1") == "arxiv:2501.01234"
    assert source_id_for(doi=None, openalex_id="W1") == "openalex:W1"
    assert source_id_for(doi=None) is None


def test_year_from():
    assert year_from("2025-07-05") == 2025
    assert year_from("2025") == 2025
    assert year_from(None) is None


def _rec(sid, title, doi=None, abstract=None, **kw):
    return SourceRecord(source_id=sid, title=title, doi=doi, abstract=abstract, url_or_doi="u", provider="t", **kw)


def test_dedupe_sources_prefers_longer_abstract_and_merges_ids():
    a = _rec("doi:10.1/x", "A paper", doi="10.1/x", abstract="short", openalex_id="W1")
    b = _rec("doi:10.1/x", "A paper", doi="10.1/x", abstract="a much longer abstract", license="cc-by")
    c = _rec("openalex:W2", "Another  Paper", abstract="x")
    d = _rec("s2:abc", "another paper", abstract="xy")
    out = dedupe_sources([a, b, c, d])
    assert len(out) == 2
    merged = next(r for r in out if r.doi == "10.1/x")
    assert merged.abstract == "a much longer abstract"
    assert merged.openalex_id == "W1" and merged.license == "cc-by"
