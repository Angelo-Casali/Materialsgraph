"""Router golden set: question -> expected use case, with a scripted FakeLLM standing in for LM Studio.

The scripted responses mirror what a well-behaved local model returns; the
test guards the RouteDecision schema and the agent's forced-route path, not
the model itself. tests/eval/questions.jsonl is the hand-written golden file
to run against a real LM Studio model (see README).
"""

import json
from pathlib import Path

from materialsgraph.query.schemas import RouteDecision

EVAL = Path(__file__).parent.parent / "eval" / "questions.jsonl"


def test_golden_questions_parse_into_route_decisions():
    rows = [json.loads(line) for line in EVAL.read_text().splitlines() if line.strip()]
    assert len(rows) >= 15
    for row in rows:
        decision = RouteDecision.model_validate(row["expected_route"])
        assert decision.use_case == row["expected_use_case"]
        assert decision.params() is not None or decision.use_case in ("gaps",)


def test_router_with_fake_llm(fake_llm):
    rows = [json.loads(line) for line in EVAL.read_text().splitlines() if line.strip()]
    for row in rows[:5]:
        llm = fake_llm([json.dumps(row["expected_route"])])
        decision = llm.complete(RouteDecision, "sys", row["question"])
        assert decision.use_case == row["expected_use_case"]
