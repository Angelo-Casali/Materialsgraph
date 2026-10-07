import json
from pathlib import Path

import pytest

from materialsgraph.harvest.resolve import resolve_for_query
from materialsgraph.llm.local_client import FallbackLLM, LLMUnavailable, StructuredLLM, llm_settings
from materialsgraph.query import cypher_safety, tools
from materialsgraph.site.build import build_sample_snapshot
from materialsgraph.site.import_snapshot import ImportRefused, estimate_size, import_snapshot
from materialsgraph.site.snapshot_models import SAMPLE_SOURCE_ID, Snapshot

FIXTURES = Path(__file__).parent.parent / "fixtures"
CASES = json.loads((FIXTURES / "feasibility_cases.json").read_text())
REPO = Path(__file__).parent.parent.parent


# --- parity fixtures (also run by web/src/lib/engine/feasibility.test.ts) ---------

@pytest.mark.parametrize("case", CASES["classify"], ids=lambda c: c["name"])
def test_classify_parity(case):
    assert tools._classify(case["req"], case["values"]) == case["expected"]


@pytest.mark.parametrize("case", CASES["verdict"], ids=lambda c: c["name"])
def test_verdict_parity(case):
    assert tools._verdict(case["assessment"]) == case["expected"]


# --- sample snapshot honesty ---------------------------------------------------

def test_sample_snapshot_is_labelled_and_honest():
    snap = build_sample_snapshot()
    assert snap.meta.sample is True and "Not for citation" in snap.meta.notice
    assert [s.source_id for s in snap.sources] == [SAMPLE_SOURCE_ID]
    assert snap.sources[0].citable is False
    assert snap.gaps == []
    for m in snap.materials:
        assert m.key.startswith("sample:")
        assert m.mp_id is None
        assert all(p.source_id == SAMPLE_SOURCE_ID for p in m.properties)
        assert all(u.source_id == SAMPLE_SOURCE_ID for u in m.used_in)
        assert all(s.confirmed is False for s in m.similar)
    assert all(s.doi is None for s in snap.sources)


def test_sample_values_within_plausible_ranges_and_known_apps():
    snap = build_sample_snapshot()
    plausible = {p.name: p.plausible for p in snap.property_types}
    apps = {a.name for a in snap.applications}
    for m in snap.materials:
        for p in m.properties:
            lo, hi = plausible[p.property_type]
            assert lo <= p.value <= hi, (m.key, p)
        for u in m.used_in:
            assert u.application in apps


def test_sample_has_review_gate_and_conflict_examples():
    snap = build_sample_snapshot()
    assert any(not u.confirmed for m in snap.materials for u in m.used_in)
    llzo = next(m for m in snap.materials if m.common_name == "LLZO")
    sig = [p.value for p in llzo.properties if p.property_type == "ionic_conductivity"]
    assert len(sig) == 2 and max(sig) / min(sig) > 10


def test_committed_snapshot_matches_builder_shape():
    path = REPO / "web" / "public" / "data" / "snapshot.json"
    snap = Snapshot.read(path)
    fresh = build_sample_snapshot()
    assert sorted(m.key for m in snap.materials) == sorted(m.key for m in fresh.materials), "run `mg site build-sample`"
    assert snap.aliases["llzo"] == "sample:Li7La3Zr2O12"
    assert snap.aliases["ethylene carbonate"] == "sample:mol:ec"


# --- importer ------------------------------------------------------------------

class RecordingSession:
    def __init__(self, real_materials=0):
        self.queries = []
        self.real_materials = real_materials

    def run(self, q, **params):
        self.queries.append((q, params))

        class R(list):
            def single(self_inner):
                return self_inner[0] if self_inner else None

            def data(self_inner):
                return list(self_inner)

        if "NOT m.material_key STARTS WITH" in q:
            return R([{"n": self.real_materials}])
        if "COMPOSED_OF" in q and "rows" in params:
            return R([{"n": len(params["rows"])}])
        if "RETURN count(" in q:
            return R([{"n": 1}])
        return R([])


def test_import_refuses_to_mix_sample_into_real_graph():
    with pytest.raises(ImportRefused):
        import_snapshot(RecordingSession(real_materials=5), build_sample_snapshot(), seed_elements=False)


def test_import_writes_through_writers(monkeypatch):
    from materialsgraph.ingestion import schema_loader

    monkeypatch.setattr(schema_loader, "apply_schema", lambda s: 0)
    monkeypatch.setattr(schema_loader, "seed_reference_data", lambda s, with_elements=True: None)
    sess = RecordingSession()
    snap = build_sample_snapshot()
    counts = import_snapshot(sess, snap, seed_elements=False)
    assert counts["materials"] == len(snap.materials)
    assert counts["property_values"] == snap.meta.counts["property_values"]
    assert any("MERGE (m:Material {material_key: $material_key})" in q for q, _ in sess.queries)
    assert not any("CREATE (" in q for q, _ in sess.queries)


def test_estimate_size_is_small_for_sample():
    nodes, rels = estimate_size(build_sample_snapshot())
    assert nodes < 500 and rels < 2000


# --- LLM profiles / fallback ---------------------------------------------------

def test_query_profile_reads_query_env(monkeypatch):
    monkeypatch.setenv("LM_STUDIO_BASE_URL", "http://localhost:1234/v1")
    monkeypatch.setenv("QUERY_LLM_BASE_URL", "https://api.example.test/v1")
    monkeypatch.setenv("QUERY_LLM_MODEL", "free-model")
    monkeypatch.setenv("QUERY_LLM_MAX_TOKENS", "600")
    q = llm_settings("query")
    assert q.base_url == "https://api.example.test/v1" and q.model == "free-model" and q.max_tokens == 600
    e = llm_settings("extract")
    assert e.base_url == "http://localhost:1234/v1"  # extraction never leaves the machine


class _RateLimited(Exception):
    status_code = 429


def test_fallback_llm_switches_on_quota(fake_llm):
    def boom(messages, rf, t):
        raise _RateLimited("429 too many requests")

    first = StructuredLLM(model="a", raw_complete=boom)
    second = fake_llm(["hello"], model="b")
    llm = FallbackLLM(first, second)
    assert llm.text("s", "u") == "hello"
    assert llm.last_provider.endswith("#b")


def test_fallback_llm_raises_when_all_fail():
    def boom(messages, rf, t):
        raise _RateLimited("429")

    with pytest.raises(LLMUnavailable):
        FallbackLLM(StructuredLLM(model="a", raw_complete=boom)).text("s", "u")


# --- read-only timeout ---------------------------------------------------------

def test_run_read_only_attaches_timeout():
    captured = {}

    class Sess:
        def execute_read(self, fn):
            captured["timeout"] = getattr(fn, "timeout", None)
            return []

    cypher_safety.run_read_only(Sess(), "MATCH (n) RETURN n", timeout_s=7.0)
    assert captured["timeout"] == 7.0


# --- resolver without pymatgen -------------------------------------------------

class _Sess:
    def __init__(self, rows, exists=None):
        self.rows, self.exists = rows, exists

    def run(self, q, **p):
        class R(list):
            def single(self_inner):
                return self_inner[0] if self_inner else None

            def data(self_inner):
                return list(self_inner)

        if "material_key: $k" in q:
            return R([self.exists] if self.exists and p["k"] == self.exists["k"] else [])
        return R(self.rows)


def test_resolve_for_query_by_key_and_alias():
    assert resolve_for_query(_Sess([], {"k": "sample:LiFePO4", "kind": "crystal", "rf": "LiFePO4"}), None, material_key="sample:LiFePO4").material_key == "sample:LiFePO4"
    res = resolve_for_query(_Sess([{"k": "sample:Li7La3Zr2O12", "kind": "crystal", "rf": "Li7La3Zr2O12", "eah": None}]), "LLZO")
    assert res.status == "matched" and res.material_key == "sample:Li7La3Zr2O12"
    multi = resolve_for_query(_Sess([{"k": "a", "kind": "crystal", "rf": "X", "eah": 0.0}, {"k": "b", "kind": "crystal", "rf": "X", "eah": 0.1}]), "X")
    assert multi.status == "ambiguous" and multi.candidates == ["a", "b"]
