import json
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from mg_api.app import create_app
from mg_api.ratelimit import RateLimiter
from mg_api.settings import ApiSettings

from materialsgraph.query import tools
from materialsgraph.query.schemas import FeasibilityParams, RouteDecision
from materialsgraph.query.tools import ToolResult

ORIGIN = "https://angelo-casali.github.io"


class R(list):
    def single(self):
        return self[0] if self else None

    def data(self):
        return list(self)


class FakeSession:
    def run(self, q, **p):
        if "count(m) AS n" in q and "sample" in q:
            return R([{"n": 3, "sample": 3}])
        if "UNWIND $ids AS id" in q:
            return R([{"source_id": i, "title": f"T {i}", "year": 2024, "doi": None} for i in p["ids"]])
        if "RETURN m.material_key AS key" in q:
            return R([{"key": "sample:LiFePO4", "formula": "LiFePO4", "common_name": "LFP", "kind": "crystal"}])
        return R([])


def factory(session=None, fail: Exception | None = None):
    @contextmanager
    def f():
        if fail:
            raise fail
        yield session or FakeSession()

    return f


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def make_client(*, llm=None, settings=None, session_factory=None, clock=None):
    clock = clock or Clock()
    limiter = RateLimiter(clock=clock, wall=lambda: datetime(2026, 10, 7, 12, tzinfo=timezone.utc))
    app = create_app(settings or ApiSettings(), session_factory=session_factory or factory(), llm=llm, embedder=None, limiter=limiter)
    return TestClient(app), clock


def test_health_shallow_and_deep():
    client, _ = make_client()
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["db"] == "skipped" and r.json()["llm"] == "none"
    r = client.get("/api/health?deep=1")
    assert r.json()["db"] == "ok" and r.json()["sample"] is True


def test_health_reports_unreachable_db():
    class ServiceUnavailable(Exception):
        pass

    client, _ = make_client(session_factory=factory(fail=ServiceUnavailable("down")))
    r = client.get("/api/health?deep=1")
    assert r.status_code == 200 and r.json()["db"] == "unreachable"


def test_cors_allows_pages_origin_only():
    client, _ = make_client()
    ok = client.options("/api/health", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == ORIGIN
    bad = client.options("/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert bad.headers.get("access-control-allow-origin") is None


def test_feasibility_tool_endpoint(monkeypatch):
    def fake(s, p, material_key=None):
        assert material_key == "sample:LiFePO4"
        return ToolResult(rows=[{"property_type": "voltage", "status": "met"}], source_ids=["sample:illustrative"], cypher=["MATCH ..."], extra={"verdict": "feasible"})

    monkeypatch.setattr(tools, "feasibility", fake)
    client, _ = make_client()
    r = client.post("/api/tools/feasibility", json={"material": "LFP", "application": "cathode", "material_key": "sample:LiFePO4"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["extra"]["verdict"] == "feasible" and body["citations"][0]["source_id"] == "sample:illustrative"


def test_tool_endpoint_maps_sleeping_db_to_503():
    class ServiceUnavailable(Exception):
        pass

    client, _ = make_client(session_factory=factory(fail=ServiceUnavailable("Aura instance paused")))
    r = client.post("/api/tools/gaps", json={})
    assert r.status_code == 503 and "asleep" in r.json()["detail"]


def test_screening_bounds_are_enforced():
    client, _ = make_client()
    r = client.post("/api/tools/screening", json={"constraints": [{"property_type": "voltage"}] * 6})
    assert r.status_code == 422


def test_rate_limit_returns_429_with_retry_after(monkeypatch):
    monkeypatch.setattr(tools, "gap_report", lambda s, p: ToolResult())
    client, clock = make_client(settings=ApiSettings(tools_per_min=6, tools_burst=2))
    assert client.post("/api/tools/gaps", json={}).status_code == 200
    assert client.post("/api/tools/gaps", json={}).status_code == 200
    r = client.post("/api/tools/gaps", json={})
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    clock.t += 10.0  # 6/min refills one token every 10 s
    assert client.post("/api/tools/gaps", json={}).status_code == 200


def test_rate_limit_keys_on_forwarded_ip(monkeypatch):
    monkeypatch.setattr(tools, "gap_report", lambda s, p: ToolResult())
    client, _ = make_client(settings=ApiSettings(tools_per_min=1, tools_burst=1))
    assert client.post("/api/tools/gaps", json={}, headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    assert client.post("/api/tools/gaps", json={}, headers={"x-forwarded-for": "2.2.2.2"}).status_code == 200
    assert client.post("/api/tools/gaps", json={}, headers={"x-forwarded-for": "1.1.1.1"}).status_code == 429


def test_ask_rejects_long_questions_and_freeform():
    client, _ = make_client()
    assert client.post("/api/ask", json={"question": "x" * 301}).status_code == 422
    assert client.post("/api/ask", json={"question": "count things", "use_case": "freeform"}).status_code == 422


def test_ask_without_llm_is_degraded_not_broken():
    client, _ = make_client(llm=None)
    r = client.post("/api/ask", json={"question": "Is LFP a good cathode?"})
    assert r.status_code == 200 and r.json()["degraded"] is True and "guided" in r.json()["message"]


def test_ask_with_llm(monkeypatch, fake_llm):
    monkeypatch.setattr(
        tools, "feasibility",
        lambda s, p, material_key=None: ToolResult(rows=[{"property_type": "voltage", "status": "met", "values": []}], source_ids=["sample:illustrative"], extra={"verdict": "feasible on available data"}),
    )
    monkeypatch.setattr(tools, "retrieve_sources", lambda s, p, e=None: ToolResult())
    route = RouteDecision(use_case="feasibility", rationale="x", feasibility=FeasibilityParams(material="LFP", application="Li-ion cathode"))
    llm = fake_llm([route.model_dump_json(), "LFP meets the voltage target [sample:illustrative] and an invented claim [doi:10.9/x]."])
    client, _ = make_client(llm=llm)
    r = client.post("/api/ask", json={"question": "Is LFP a good Li-ion cathode?"})
    assert r.status_code == 200, r.text
    ans = r.json()["answer"]
    assert ans["use_case"] == "feasibility"
    assert "[sample:illustrative]" in ans["text"] and "doi:10.9/x" not in ans["text"]


def test_ask_llm_unavailable_degrades(monkeypatch):
    from materialsgraph.llm.local_client import LLMUnavailable

    class DeadLLM:
        model = "x"

        def complete(self, *a, **k):
            raise LLMUnavailable("429")

        def text(self, *a, **k):
            raise LLMUnavailable("429")

    client, _ = make_client(llm=DeadLLM())
    r = client.post("/api/ask", json={"question": "anything at all"})
    assert r.status_code == 200 and r.json()["degraded"] is True


def test_daily_llm_budget(monkeypatch):
    client, _ = make_client(llm=object(), settings=ApiSettings(daily_llm_budget=1))
    r = client.post("/api/ask", json={"question": "anything at all"})
    assert r.json()["degraded"] is True and "budget" in r.json()["message"]


def test_body_size_cap():
    client, _ = make_client()
    r = client.post("/api/ask", content=json.dumps({"question": "a" * 10000}), headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_meta_and_materials():
    client, _ = make_client()
    meta = client.get("/api/meta").json()
    assert "freeform" not in meta["use_cases"] and meta["llm"] is False
    mats = client.get("/api/materials").json()["materials"]
    assert mats[0]["key"] == "sample:LiFePO4"


@pytest.mark.parametrize("path", ["/api/docs", "/api/openapi.json"])
def test_docs_available(path):
    client, _ = make_client()
    assert client.get(path).status_code == 200
