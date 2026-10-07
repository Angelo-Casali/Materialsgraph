"""Composition-based SIMILAR_TO edges (always confirmed=false; a human flips them)."""

from __future__ import annotations

import math

from neo4j import Session

from materialsgraph.graph import writers

METHOD = "composition_cosine_v1"


def composition_vectors(session: Session, kind: str = "crystal") -> dict[str, dict[str, float]]:
    rows = session.run(
        """
        MATCH (m:Material {kind: $kind})-[c:COMPOSED_OF]->(e:Element)
        RETURN m.material_key AS k, collect({s: e.symbol, f: c.fraction}) AS comp
        """,
        kind=kind,
    )
    return {r["k"]: {c["s"]: float(c["f"] or 0.0) for c in r["comp"]} for r in rows}


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    dot = sum(v * b.get(k, 0.0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def top_k_similar(vectors: dict[str, dict[str, float]], *, top_k: int = 5, min_score: float = 0.85) -> list[tuple[str, str, float]]:
    """Brute force is fine for a few thousand materials; element-set blocking keeps it fast."""
    by_anion: dict[frozenset, list[str]] = {}
    for key, comp in vectors.items():
        block = frozenset(e for e in comp if e in {"O", "S", "Se", "F", "Cl", "Br", "I", "N", "P"}) or frozenset({"_"})
        by_anion.setdefault(block, []).append(key)
    edges: list[tuple[str, str, float]] = []
    for block_keys in by_anion.values():
        for a in block_keys:
            scored = []
            for b in block_keys:
                if a == b:
                    continue
                s = cosine(vectors[a], vectors[b])
                if s >= min_score:
                    scored.append((s, b))
            scored.sort(reverse=True)
            for s, b in scored[:top_k]:
                edges.append((a, b, round(s, 4)))
    return edges


def write_similar_to(session: Session, *, top_k: int = 5, min_score: float = 0.85) -> int:
    vectors = composition_vectors(session)
    edges = top_k_similar(vectors, top_k=top_k, min_score=min_score)
    for a, b, s in edges:
        writers.upsert_similar_to(session, from_key=a, to_key=b, method=METHOD, score=s, confirmed=False)
    return len(edges)
