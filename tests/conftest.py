from __future__ import annotations

import json
from pathlib import Path

import pytest

from materialsgraph.llm.local_client import StructuredLLM

FIXTURES = Path(__file__).parent / "fixtures"


def _neo4j_available() -> bool:
    from materialsgraph.graph.connection import neo4j_reachable

    return neo4j_reachable(timeout_s=1.5)


def pytest_collection_modifyitems(config, items):
    if _neo4j_available():
        return
    skip = pytest.mark.skip(reason="Neo4j not reachable (set NEO4J_URI / start docker compose)")
    for item in items:
        if "neo4j" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
def fixture_json():
    def _load(name: str):
        return json.loads((FIXTURES / name).read_text())

    return _load


class FakeLLM(StructuredLLM):
    """StructuredLLM whose raw completion is scripted: a list of response strings consumed in order,
    or a callable (messages, response_format, temperature) -> str."""

    def __init__(self, responses, model="fake-model"):
        self._responses = list(responses) if isinstance(responses, (list, tuple)) else None
        self._fn = responses if callable(responses) else None
        self.calls: list[list[dict]] = []
        super().__init__(model=model, raw_complete=self._raw, max_retries=2)

    def _raw(self, messages, response_format, temperature):
        self.calls.append(messages)
        if self._fn is not None:
            return self._fn(messages, response_format, temperature)
        if not self._responses:
            raise RuntimeError("FakeLLM ran out of scripted responses")
        return self._responses.pop(0)


@pytest.fixture
def fake_llm():
    return FakeLLM
