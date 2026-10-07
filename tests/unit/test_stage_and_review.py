from materialsgraph.harvest import stage
from materialsgraph.harvest.models import CandidatePropertyValue, CandidateUsedIn, ReviewDecision, SourceRecord
from materialsgraph.harvest.review_cli import review_batch


def _cands():
    a = CandidatePropertyValue(source_id="doi:1", quote="q", formula_raw="LiFePO4", property_type="voltage", value=3.4, unit_raw="V", llm_confidence=0.9)
    b = CandidateUsedIn(source_id="doi:1", quote="q2", formula_raw="LiFePO4", application_raw="cathode")
    for c in (a, b):
        c.ensure_id()
    return [a, b]


def test_queue_roundtrip_and_stats(tmp_path, monkeypatch):
    monkeypatch.setattr(stage, "QUEUE_DIR", tmp_path / "queue")
    monkeypatch.setattr(stage, "SOURCES_DIR", tmp_path / "sources")
    monkeypatch.setattr(stage, "CURATED_DIR", tmp_path / "curated")
    cands = _cands()
    stage.write_queue("b1", cands)
    stage.write_sources("b1", [SourceRecord(source_id="doi:1", title="T", url_or_doi="u", provider="t", abstract="x")])
    back = stage.read_queue("b1")
    assert [c.candidate_id for c in back] == [c.candidate_id for c in cands]
    assert stage.list_batches() == ["b1"]
    stats = stage.queue_stats(back)
    assert stats["total"] == 2 and stats["by_kind"] == {"property_value": 1, "used_in": 1}

    back[0].status = "accepted"
    back[0].review = ReviewDecision(status="accepted")
    path = stage.append_curated("b1", [back[0]])
    stage.append_curated("b1", [back[0]])  # idempotent
    assert len(path.read_text().splitlines()) == 1


def test_review_cli_scripted(tmp_path, monkeypatch):
    monkeypatch.setattr(stage, "QUEUE_DIR", tmp_path / "queue")
    monkeypatch.setattr(stage, "SOURCES_DIR", tmp_path / "sources")
    cands = _cands()
    stage.write_queue("b2", cands)
    keys = iter(["a", "r", "bad data"])
    out = []
    counts = review_batch("b2", input_fn=lambda prompt="": next(keys), print_fn=out.append)
    assert counts["accepted"] == 1 and counts["rejected"] == 1
    saved = stage.read_queue("b2")
    assert saved[0].status == "accepted" and saved[1].status == "rejected"
    assert saved[1].review.note == "bad data"
