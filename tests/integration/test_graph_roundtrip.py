"""End-to-end against a live Neo4j (skipped when unreachable). Uses a throwaway label-free namespace via unique keys."""

import uuid

import pytest

from materialsgraph.graph import queries, writers
from materialsgraph.graph.connection import session as open_session
from materialsgraph.graph.reference import DOMAIN_NAME, MP_SOURCE_ID
from materialsgraph.harvest.resolve import resolve_formula
from materialsgraph.ingestion import schema_loader
from materialsgraph.query import tools
from materialsgraph.query.cypher_safety import UnsafeCypherError, run_read_only
from materialsgraph.query.schemas import CompositionParams, FeasibilityParams, GapParams, ScreeningParams

pytestmark = pytest.mark.neo4j


@pytest.fixture(scope="module")
def s():
    with open_session() as sess:
        schema_loader.apply_schema(sess)
        schema_loader.seed_reference_data(sess)
        yield sess


@pytest.fixture
def material(s):
    key = f"test:{uuid.uuid4().hex[:8]}"
    writers.upsert_material(s, material_key=key, formula="LiFePO4", reduced_formula="LiFePO4", mp_id=None, data_source="test", provider="test")
    writers.upsert_composed_of(s, key, {"Li": 1, "Fe": 1, "P": 1, "O": 4})
    for prop, val in [("voltage", 3.4), ("specific_capacity", 170.0), ("energy_above_hull", 0.0)]:
        writers.upsert_property_value(s, material_key=key, property_type=prop, value=val, unit=None, source_id=MP_SOURCE_ID, source_type="dft", confidence="high", confirmed=True)
    writers.upsert_used_in(s, material_key=key, application="Li-ion cathode", source_id=MP_SOURCE_ID, confirmed=True, basis="computed")
    yield key
    s.run("MATCH (m:Material {material_key: $k}) OPTIONAL MATCH (m)-[:HAS_PROPERTY]->(pv) DETACH DELETE m, pv", k=key)


def test_schema_statement_count(s):
    assert schema_loader.apply_schema(s) >= 25


def test_elements_seeded_with_flags(s):
    row = s.run("MATCH (e:Element {symbol: 'Co'}) RETURN e.atomic_number AS z, e.eu_crm_2023 AS eu").single()
    assert row["z"] == 27 and row["eu"] is True


def test_writers_roundtrip_and_profile(s, material):
    profile = queries.material_profile(s, material)
    assert {e["symbol"] for e in profile["elements"]} == {"Li", "Fe", "P", "O"}
    assert any(p["property_type"] == "voltage" and p["source_type"] == "dft" for p in profile["properties"])
    assert profile["applications"][0]["basis"] == "computed"


def test_property_values_from_two_sources_coexist(s, material):
    writers.upsert_source(s, source_id="doi:test/1", title="t", type="paper")
    writers.upsert_property_value(s, material_key=material, property_type="voltage", value=3.45, unit="V", source_id="doi:test/1", source_type="literature_asserted", confidence=0.8, confirmed=False, quote="3.45 V")
    n = s.run("MATCH (:Material {material_key: $k})-[:HAS_PROPERTY]->(pv {property_type: 'voltage'}) RETURN count(pv) AS n", k=material).single()["n"]
    assert n == 2


def test_resolver_matches_graph_material(s, material):
    res = resolve_formula("FeLiO4P", s)
    assert res.status in ("matched", "ambiguous")
    assert material in ([res.material_key] + res.candidates)


def test_feasibility_tool(s, material):
    tr = tools.feasibility(s, FeasibilityParams(material="LiFePO4", application="cathode"))
    statuses = {r["property_type"]: r["status"] for r in tr.rows}
    assert statuses["voltage"] == "met" and statuses["specific_capacity"] == "met"
    assert "feasible" in tr.extra["verdict"]


def test_screening_tool_excludes_cobalt(s, material):
    tr = tools.screen_materials(s, ScreeningParams(exclude_elements=["Co"], include_elements=["Fe"], constraints=[{"property_type": "specific_capacity", "min": 150}]))
    assert any(r["material_key"] == material for r in tr.rows)
    assert MP_SOURCE_ID in tr.source_ids


def test_composition_tool_flags_critical_elements(s, material):
    tr = tools.composition_analysis(s, CompositionParams(material="LiFePO4"))
    crit = {e["symbol"] for e in tr.rows[0]["critical_elements"]}
    assert "Li" in crit and "P" in crit


def test_gap_report(s):
    tr = tools.gap_report(s, GapParams(application="solid electrolyte"))
    assert any(r["property_type"] == "ionic_conductivity" for r in tr.rows)


def test_read_only_executor_blocks_writes(s):
    with pytest.raises(UnsafeCypherError):
        run_read_only(s, "MATCH (m:Material) SET m.x = 1 RETURN m")
    rows = run_read_only(s, "MATCH (d:Domain) RETURN d.name AS name")
    assert any(r["name"] == DOMAIN_NAME for r in rows)
