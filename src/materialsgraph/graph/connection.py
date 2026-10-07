"""Neo4j driver helpers shared by every module that touches the graph."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from dotenv import load_dotenv


def _settings() -> tuple[str, str, str]:
    load_dotenv()
    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "")
    return uri, user, password


def get_driver():
    """Create a neo4j Driver from .env / environment variables."""
    from neo4j import GraphDatabase  # local import: keeps this module importable without neo4j

    uri, user, password = _settings()
    return GraphDatabase.driver(uri, auth=(user, password))


@contextmanager
def session() -> Iterator:
    """`with session() as s:` -- opens and closes a driver around one session."""
    driver = get_driver()
    try:
        with driver.session() as s:
            yield s
    finally:
        driver.close()


def neo4j_reachable(timeout_s: float = 2.0) -> bool:
    """True when a Neo4j instance answers on the configured URI. Used by test skip markers."""
    try:
        from neo4j import GraphDatabase
    except ImportError:
        return False
    uri, user, password = _settings()
    try:
        driver = GraphDatabase.driver(uri, auth=(user, password), connection_timeout=timeout_s)
        try:
            driver.verify_connectivity()
        finally:
            driver.close()
        return True
    except Exception:
        return False
