"""Read-only guard for LLM-generated Cypher.

Two lines of defence: this validator rejects anything that could write or
call procedures outside a small allowlist, and the executor always runs the
statement inside `session.execute_read`, where Neo4j itself refuses writes.
"""

from __future__ import annotations

import re

MAX_LIMIT_DEFAULT = 200

_WRITE_KEYWORDS = [
    "CREATE", "MERGE", "DELETE", "DETACH", "SET", "REMOVE", "DROP", "FOREACH",
    "LOAD CSV", "USING PERIODIC COMMIT", "CALL {", "CALL{", "ALTER", "GRANT", "DENY", "REVOKE",
    "START DATABASE", "STOP DATABASE", "CREATE DATABASE", "TERMINATE",
]
_PROC_ALLOWLIST = {"db.index.vector.queryNodes", "db.index.fulltext.queryNodes"}
_FIRST_TOKENS = {"MATCH", "OPTIONAL", "WITH", "UNWIND", "CALL", "RETURN", "EXPLAIN", "PROFILE"}


class UnsafeCypherError(ValueError):
    pass


def _strip_literals_and_comments(cypher: str) -> str:
    text = re.sub(r"//[^\n]*", " ", cypher)
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.DOTALL)
    text = re.sub(r"'(?:\\.|[^'\\])*'", "''", text)
    text = re.sub(r'"(?:\\.|[^"\\])*"', '""', text)
    text = re.sub(r"`[^`]*`", "``", text)
    return text


def validate_read_only(cypher: str, *, max_limit: int = MAX_LIMIT_DEFAULT) -> str:
    """Return a sanitized, read-only Cypher statement with a bounded LIMIT, or raise UnsafeCypherError."""
    if not cypher or not cypher.strip():
        raise UnsafeCypherError("empty statement")
    stripped = _strip_literals_and_comments(cypher)
    upper = re.sub(r"\s+", " ", stripped).strip().upper()

    if ";" in upper.rstrip(";"):
        raise UnsafeCypherError("multiple statements are not allowed")
    for kw in _WRITE_KEYWORDS:
        if re.search(r"(?<![A-Z_])" + re.escape(kw) + r"(?![A-Z_])", upper):
            raise UnsafeCypherError(f"write/admin keyword not allowed: {kw}")
    for proc in re.findall(r"CALL\s+([A-Za-z_][\w.]*)", stripped, flags=re.IGNORECASE):
        if proc not in _PROC_ALLOWLIST:
            raise UnsafeCypherError(f"procedure not allowed: {proc}")
    if re.search(r"\b(APOC|DBMS|GDS)\.", upper):
        raise UnsafeCypherError("apoc/dbms/gds procedures are not allowed")
    first = upper.split(" ", 1)[0]
    if first not in _FIRST_TOKENS:
        raise UnsafeCypherError(f"statement must start with one of {sorted(_FIRST_TOKENS)}, got {first!r}")

    if not re.search(r"\bRETURN\b", upper):
        raise UnsafeCypherError("statement has no RETURN clause")
    out = cypher.strip().rstrip(";").strip()
    m = re.search(r"\bLIMIT\s+(\d+)\s*$", out, flags=re.IGNORECASE)
    if m:
        if int(m.group(1)) > max_limit:
            out = out[: m.start()] + f"LIMIT {max_limit}"
    elif re.search(r"\bLIMIT\s+\$\w+\s*$", out, flags=re.IGNORECASE):
        pass  # parameterised limit; caller bounds the parameter
    else:
        out += f"\nLIMIT {max_limit}"
    return out


def run_read_only(session, cypher: str, params: dict | None = None, *, max_limit: int = MAX_LIMIT_DEFAULT, timeout_s: float = 15.0) -> list[dict]:
    """Validate, then execute inside a read transaction with a server-side timeout.

    `neo4j.unit_of_work(timeout=...)` is how the 5.x/6.x drivers attach a
    transaction timeout to a managed transaction function; passing `timeout=`
    to `execute_read` itself is silently ignored.
    """
    from neo4j import unit_of_work

    safe = validate_read_only(cypher, max_limit=max_limit)
    params = dict(params or {})
    if "max_limit" in params:
        params["max_limit"] = min(int(params["max_limit"]), max_limit)

    @unit_of_work(timeout=timeout_s)
    def work(tx):
        return [dict(r) for r in tx.run(safe, **params)]

    return session.execute_read(work)
