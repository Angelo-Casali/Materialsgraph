from materialsgraph.enrichment.similarity import cosine, top_k_similar
from materialsgraph.query.graphrag import _enforce_citations
from materialsgraph.query.schemas import RouteDecision, ScreeningParams


def test_cosine_and_blocking():
    vectors = {
        "a": {"Li": 0.5, "Co": 0.25, "O": 0.25},
        "b": {"Li": 0.45, "Ni": 0.3, "O": 0.25},
        "c": {"Li": 0.5, "P": 0.17, "S": 0.33},  # sulfide block, never compared with oxides
    }
    assert abs(cosine(vectors["a"], vectors["a"]) - 1.0) < 1e-9
    edges = top_k_similar(vectors, top_k=5, min_score=0.5)
    pairs = {(a, b) for a, b, _ in edges}
    assert ("a", "b") in pairs and ("b", "a") in pairs
    assert not any("c" in p for p in pairs)


def test_route_decision_params():
    r = RouteDecision(use_case="screening", rationale="x", screening=ScreeningParams(include_elements=["Li"]))
    assert r.params().include_elements == ["Li"]
    assert RouteDecision(use_case="gaps", rationale="x").params() is None


def test_enforce_citations_strips_unknown_ids():
    text = "LFP has 3.4 V [materials-project] and 170 mAh/g [doi:10.9/fake]; see [1]."
    out, stripped = _enforce_citations(text, {"materials-project"})
    assert "[materials-project]" in out
    assert "doi:10.9/fake" not in out
    assert "[1]" in out  # non-id brackets untouched
    assert stripped == {"doi:10.9/fake"}
