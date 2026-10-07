"""JSONL review queue on disk: data/harvest/queue/<batch>.jsonl (candidates), data/harvest/sources/<batch>.jsonl."""

from __future__ import annotations

import json
import os
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from materialsgraph.harvest.models import Candidate, SourceRecord, TextChunk, parse_candidate

HARVEST_DIR = Path("data/harvest")
QUEUE_DIR = HARVEST_DIR / "queue"
SOURCES_DIR = HARVEST_DIR / "sources"
CHUNKS_DIR = HARVEST_DIR / "chunks"
CURATED_DIR = Path("curated")


def new_batch_id(slug: str) -> str:
    safe = "".join(ch if ch.isalnum() else "-" for ch in slug.lower()).strip("-")[:40] or "batch"
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M") + "-" + safe


def queue_path(batch_id: str) -> Path:
    return QUEUE_DIR / f"{batch_id}.jsonl"


def sources_path(batch_id: str) -> Path:
    return SOURCES_DIR / f"{batch_id}.jsonl"


def chunks_path(batch_id: str) -> Path:
    return CHUNKS_DIR / f"{batch_id}.jsonl"


def curated_path(batch_id: str) -> Path:
    return CURATED_DIR / f"{batch_id}.accepted.jsonl"


def _atomic_write_lines(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".jsonl")
    with os.fdopen(fd, "w") as fh:
        for line in lines:
            fh.write(line + "\n")
    os.replace(tmp, path)


def write_sources(batch_id: str, records: list[SourceRecord]) -> Path:
    path = sources_path(batch_id)
    _atomic_write_lines(path, [r.model_dump_json() for r in records])
    return path


def read_sources(batch_id: str) -> list[SourceRecord]:
    path = sources_path(batch_id)
    if not path.exists():
        return []
    return [SourceRecord.model_validate_json(line) for line in path.read_text().splitlines() if line.strip()]


def write_chunks(batch_id: str, chunks: list[TextChunk]) -> Path:
    path = chunks_path(batch_id)
    _atomic_write_lines(path, [c.model_dump_json() for c in chunks])
    return path


def read_chunks(batch_id: str) -> list[TextChunk]:
    path = chunks_path(batch_id)
    if not path.exists():
        return []
    return [TextChunk.model_validate_json(line) for line in path.read_text().splitlines() if line.strip()]


def write_queue(batch_id: str, candidates: list[Candidate]) -> Path:
    path = queue_path(batch_id)
    _atomic_write_lines(path, [c.model_dump_json() for c in candidates])
    return path


def read_queue(batch_id: str) -> list[Candidate]:
    path = queue_path(batch_id)
    if not path.exists():
        raise FileNotFoundError(f"no queue for batch {batch_id!r} at {path}")
    return [parse_candidate(json.loads(line)) for line in path.read_text().splitlines() if line.strip()]


def append_curated(batch_id: str, candidates: list[Candidate]) -> Path:
    """Accepted candidates are mirrored into curated/ (git-tracked): the project's real dataset."""
    path = curated_path(batch_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = set()
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                existing.add(json.loads(line)["candidate_id"])
    with path.open("a") as fh:
        for c in candidates:
            if c.candidate_id not in existing:
                fh.write(c.model_dump_json() + "\n")
    return path


def list_batches() -> list[str]:
    if not QUEUE_DIR.exists():
        return []
    return sorted(p.stem for p in QUEUE_DIR.glob("*.jsonl"))


def queue_stats(candidates: list[Candidate]) -> dict:
    by_kind = Counter(c.kind for c in candidates)
    by_status = Counter(c.status for c in candidates)
    validated = [c for c in candidates if c.validation is not None]
    pass_rate_by_kind: dict[str, float] = {}
    for kind in by_kind:
        ks = [c for c in validated if c.kind == kind]
        if ks:
            pass_rate_by_kind[kind] = round(100.0 * sum(1 for c in ks if c.validation.ok) / len(ks), 1)
    resolution = Counter((c.resolution.status if c.resolution else "n/a") for c in candidates)
    return {
        "total": len(candidates),
        "by_kind": dict(by_kind),
        "by_status": dict(by_status),
        "validation_pass_rate_pct": pass_rate_by_kind,
        "resolution": dict(resolution),
        "sources": len({c.source_id for c in candidates}),
    }
