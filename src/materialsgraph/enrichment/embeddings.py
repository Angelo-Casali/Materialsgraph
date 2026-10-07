"""Local sentence embeddings for Source abstracts and full-text Chunks.

Model is fixed at 384 dimensions to match the vector index statements in
schema.cypher; change both together.
"""

from __future__ import annotations

import os
from typing import Callable

from dotenv import load_dotenv
from neo4j import Session

from materialsgraph.graph import writers

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DIMENSIONS = 384


class Embedder:
    def __init__(self, model_name: str | None = None, *, embed_fn: Callable[[list[str]], list[list[float]]] | None = None):
        load_dotenv()
        self.model_name = model_name or os.environ.get("EMBEDDING_MODEL", DEFAULT_MODEL)
        self._embed_fn = embed_fn
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer  # lazy, heavy

            self._model = SentenceTransformer(self.model_name)
        return self._model

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        if self._embed_fn is not None:
            vectors = self._embed_fn(texts)
        else:
            vectors = self._load().encode(texts, normalize_embeddings=True, show_progress_bar=False).tolist()
        for v in vectors:
            if len(v) != DIMENSIONS:
                raise ValueError(f"embedding dimension {len(v)} != {DIMENSIONS}; schema.cypher vector indexes expect {DIMENSIONS}")
        return vectors

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]


def embed_sources(session: Session, embedder: Embedder, *, batch_size: int = 64, limit: int | None = None) -> int:
    """Embed title+abstract for Sources lacking abstract_embedding."""
    rows = session.run(
        """
        MATCH (s:Source) WHERE s.abstract IS NOT NULL AND s.abstract_embedding IS NULL
        RETURN s.source_id AS sid, s.title AS title, s.abstract AS abstract
        LIMIT $limit
        """,
        limit=limit or 1_000_000,
    ).data()
    done = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        vectors = embedder.embed_texts([f"{r['title']}\n\n{r['abstract']}" for r in batch])
        for r, v in zip(batch, vectors, strict=True):
            writers.set_source_embedding(session, r["sid"], v)
            done += 1
    return done


def embed_chunks(session: Session, embedder: Embedder, *, batch_size: int = 64, limit: int | None = None) -> int:
    rows = session.run(
        "MATCH (c:Chunk) WHERE c.embedding IS NULL RETURN c.chunk_id AS cid, c.text AS text LIMIT $limit",
        limit=limit or 1_000_000,
    ).data()
    done = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        vectors = embedder.embed_texts([r["text"] for r in batch])
        session.run(
            "UNWIND $rows AS r MATCH (c:Chunk {chunk_id: r.cid}) SET c.embedding = r.vec",
            rows=[{"cid": r["cid"], "vec": v} for r, v in zip(batch, vectors, strict=True)],
        )
        done += len(batch)
    return done
