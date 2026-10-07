"""Seed Element nodes from pymatgen's periodic table plus critical-element flags."""

from __future__ import annotations

from neo4j import Session

from materialsgraph.graph import writers
from materialsgraph.graph.reference import critical_flags

MAX_Z = 103  # up to Lr; nothing heavier appears in battery materials


def periodic_table() -> list[dict]:
    from pymatgen.core.periodic_table import Element  # lazy

    rows = []
    for el in Element:
        if el.Z > MAX_Z:
            continue
        rows.append({"symbol": el.symbol, "name": el.long_name, "atomic_number": int(el.Z)})
    return rows


def seed_elements(session: Session) -> int:
    rows = periodic_table()
    for row in rows:
        flags = critical_flags(row["symbol"])
        writers.upsert_element(session, **row, **flags)
    return len(rows)
