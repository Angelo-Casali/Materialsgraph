"""One function per GraphRAG use case. Cypher is assembled from allowlisted fragments; user input is parameters only."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from neo4j import Session

from materialsgraph.graph import queries
from materialsgraph.graph.reference import LOG_SCALE_PROPERTIES, PROPERTY_UNITS, resolve_application_name
from materialsgraph.harvest.resolve import resolve_formula
from materialsgraph.query.schemas import CompositionParams, FeasibilityParams, GapParams, LiteratureParams, ScreeningParams


@dataclass
class ToolResult:
    rows: list[dict] = field(default_factory=list)
    cypher: list[str] = field(default_factory=list)
    source_ids: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    extra: dict = field(default_factory=dict)


_VALID_SYMBOL = __import__("re").compile(r"^[A-Z][a-z]?$")


def _clean_symbols(symbols: list[str]) -> list[str]:
    return [s.strip().capitalize() for s in symbols if _VALID_SYMBOL.match(s.strip().capitalize())]


# ---------------------------------------------------------------------------
# 1. Screening / materials identification
# ---------------------------------------------------------------------------

def screen_materials(session: Session, p: ScreeningParams) -> ToolResult:
    res = ToolResult()
    include = _clean_symbols(p.include_elements)
    exclude = _clean_symbols(p.exclude_elements)
    constraints = [c for c in p.constraints if c.property_type in PROPERTY_UNITS]
    dropped = [c.property_type for c in p.constraints if c.property_type not in PROPERTY_UNITS]
    if dropped:
        res.notes.append(f"ignored unknown properties: {dropped}")
    application = resolve_application_name(p.application) if p.application else None
    if p.application and not application:
        res.notes.append(f"application {p.application!r} not recognised; screening without it")

    parts = ["MATCH (m:Material)"]
    params: dict = {"limit": max(1, min(p.limit, 100))}
    where = []
    if p.kind != "any":
        where.append("m.kind = $kind")
        params["kind"] = p.kind
    if include:
        where.append("ALL(sym IN $include WHERE (m)-[:COMPOSED_OF]->(:Element {symbol: sym}))")
        params["include"] = include
    if exclude:
        where.append("NONE(sym IN $exclude WHERE (m)-[:COMPOSED_OF]->(:Element {symbol: sym}))")
        params["exclude"] = exclude
    if application:
        where.append("(m)-[:USED_IN]->(:Application {name: $application})")
        params["application"] = application
    if where:
        parts.append("WHERE " + " AND ".join(where))

    if p.max_energy_above_hull is not None:
        parts.append(
            "MATCH (m)-[:HAS_PROPERTY]->(eah:PropertyValue {property_type: 'energy_above_hull'}) WHERE eah.value <= $max_eah"
        )
        params["max_eah"] = float(p.max_energy_above_hull)
        parts.append("WITH m, min(eah.value) AS energy_above_hull")
    else:
        parts.append("WITH m, null AS energy_above_hull")

    for i, c in enumerate(constraints):
        alias = f"pv{i}"
        parts.append(f"MATCH (m)-[:HAS_PROPERTY]->({alias}:PropertyValue {{property_type: $prop{i}}})")
        params[f"prop{i}"] = c.property_type
        conds = []
        if c.min is not None:
            conds.append(f"{alias}.value >= $min{i}")
            params[f"min{i}"] = float(c.min)
        if c.max is not None:
            conds.append(f"{alias}.value <= $max{i}")
            params[f"max{i}"] = float(c.max)
        if conds:
            parts.append("WHERE " + " AND ".join(conds))
        parts.append(
            f"WITH m, energy_above_hull{''.join(f', {k}' for k in [f'c{j}' for j in range(i)])}, "
            f"collect({{value: {alias}.value, unit: {alias}.unit, source_type: {alias}.source_type, confirmed: {alias}.confirmed, source_id: {alias}.source_id}})[0] AS c{i}"
        )

    order_prop = p.order_by if p.order_by in PROPERTY_UNITS else None
    order_idx = next((i for i, c in enumerate(constraints) if c.property_type == order_prop), None)
    collected = ", ".join(f"{{property_type: $prop{i}, value: c{i}.value, unit: c{i}.unit, source_type: c{i}.source_type, confirmed: c{i}.confirmed, source_id: c{i}.source_id}}" for i in range(len(constraints)))
    parts.append(
        f"RETURN m.material_key AS material_key, m.formula AS formula, m.kind AS kind, m.mp_id AS mp_id, "
        f"energy_above_hull, [{collected}] AS properties"
    )
    if order_idx is not None:
        parts.append(f"ORDER BY c{order_idx}.value DESC")
    elif constraints:
        parts.append("ORDER BY c0.value DESC")
    else:
        parts.append("ORDER BY energy_above_hull ASC, formula")
    parts.append("LIMIT $limit")
    cypher = "\n".join(parts)
    res.cypher.append(cypher)
    res.rows = [dict(r) for r in session.run(cypher, **params)]
    res.source_ids = sorted({pr["source_id"] for r in res.rows for pr in r["properties"] if pr.get("source_id")})
    res.extra = {"application": application, "include": include, "exclude": exclude}
    return res


# ---------------------------------------------------------------------------
# 2. Feasibility study
# ---------------------------------------------------------------------------

def _disagree(values: list[float], prop: str) -> bool:
    if len(values) < 2:
        return False
    if prop in LOG_SCALE_PROPERTIES:
        logs = [math.log10(v) for v in values if v > 0]
        return bool(logs) and (max(logs) - min(logs)) > 1.0
    lo, hi = min(values), max(values)
    return hi - lo > 0.25 * max(abs(hi), abs(lo), 1e-9)


def _classify(req: dict, values: list[dict]) -> str:
    if not values:
        return "missing"
    nums = [v["value"] for v in values if v["value"] is not None]
    if _disagree(nums, req["property_type"]):
        return "conflicting"
    # prefer confirmed, then measured > dft > literature
    rank = {"measured": 0, "dft": 1, "mlip_predicted": 2, "literature_asserted": 3}
    best = sorted(values, key=lambda v: (not v.get("confirmed"), rank.get(v.get("source_type"), 9)))[0]
    v = best["value"]
    if req.get("target_min") is not None and v < req["target_min"]:
        return "unmet"
    if req.get("target_max") is not None and v > req["target_max"]:
        return "unmet"
    return "met"


def feasibility(session: Session, p: FeasibilityParams) -> ToolResult:
    res = ToolResult()
    application = resolve_application_name(p.application)
    if not application:
        res.notes.append(f"application {p.application!r} not recognised")
        return res
    resolution = resolve_formula(p.material, session)
    if resolution.material_key is None or resolution.status in {"new_crystal", "new_molecule", "unparseable", "unresolved_variable"} and not _exists(session, resolution.material_key):
        res.notes.append(f"material {p.material!r} is not in the graph ({resolution.status}); no data to assess")
        res.extra = {"application": application, "resolution": resolution.model_dump()}
        return res
    key = resolution.material_key
    profile = queries.material_profile(session, key)
    reqs = queries.requirements_for(session, application)
    res.cypher.append("queries.material_profile + queries.requirements_for (parameterised templates)")
    assessment = []
    for req in reqs:
        values = [v for v in profile["properties"] if v["property_type"] == req["property_type"]]
        status = _classify(req, values)
        assessment.append({**req, "status": status, "values": values})
    verdict = _verdict(assessment)
    used_in = [a for a in profile["applications"]]
    gaps = queries.gaps_for(session, application)
    res.rows = assessment
    res.source_ids = sorted({v["source_id"] for a in assessment for v in a["values"] if v.get("source_id")} | {u["source_id"] for u in used_in if u.get("source_id")} | {g["source_id"] for g in gaps})
    res.extra = {
        "material": profile["material"],
        "application": application,
        "resolution": resolution.model_dump(),
        "verdict": verdict,
        "used_in": used_in,
        "similar": profile["similar"],
        "gaps": gaps,
        "requirement_level": reqs[0]["level"] if reqs else None,
    }
    if resolution.status == "ambiguous":
        res.notes.append(f"several polymorphs match {p.material!r}; assessed {key}; alternatives: {resolution.candidates}")
    return res


def _exists(session: Session, key: str | None) -> bool:
    if not key:
        return False
    return session.run("MATCH (m:Material {material_key: $k}) RETURN count(m) AS n", k=key).single()["n"] > 0


def _verdict(assessment: list[dict]) -> str:
    high = [a for a in assessment if a.get("importance") == "high"]
    if any(a["status"] == "unmet" for a in high):
        return "requirements not met on available data"
    if any(a["status"] == "conflicting" for a in high):
        return "sources disagree on a key requirement; review before concluding"
    if any(a["status"] == "missing" for a in high):
        return "insufficient data: key requirement has no value in the graph"
    if high and all(a["status"] == "met" for a in high):
        return "feasible on available data (all high-importance targets met)"
    return "no requirement targets defined for this application"


# ---------------------------------------------------------------------------
# 3. Composition / molecular analysis
# ---------------------------------------------------------------------------

def composition_analysis(session: Session, p: CompositionParams) -> ToolResult:
    res = ToolResult()
    resolution = resolve_formula(p.material, session)
    if not _exists(session, resolution.material_key):
        res.notes.append(f"material {p.material!r} not in the graph ({resolution.status})")
        res.extra = {"resolution": resolution.model_dump()}
        return res
    key = resolution.material_key
    profile = queries.material_profile(session, key)
    elements = profile["elements"]
    total = sum(e["fraction"] or 0 for e in elements) or 1.0
    critical = [e for e in elements if e.get("eu_crm_2023") or e.get("usgs_2022")]
    critical_fraction = sum(e["fraction"] or 0 for e in critical) / total
    rows = {"elements": elements, "critical_elements": critical, "critical_atom_fraction": round(critical_fraction, 3)}
    res.cypher.append("queries.material_profile")
    if p.include_substitutions and profile["material"]["kind"] == "crystal" and len(elements) >= 2:
        syms = [e["symbol"] for e in elements]
        cypher = """
            MATCH (m:Material {kind: 'crystal'})-[:COMPOSED_OF]->(e:Element)
            WHERE m.material_key <> $k
            WITH m, collect(e.symbol) AS syms
            WHERE size([s IN syms WHERE NOT s IN $syms]) = 1 AND size([s IN $syms WHERE NOT s IN syms]) = 1
              AND size(syms) = size($syms)
            RETURN m.material_key AS material_key, m.formula AS formula,
                   [s IN syms WHERE NOT s IN $syms][0] AS substituted_in,
                   [s IN $syms WHERE NOT s IN syms][0] AS substituted_out
            LIMIT 15
        """
        res.cypher.append(cypher)
        rows["substitutions"] = [dict(r) for r in session.run(cypher, k=key, syms=syms)]
    if p.include_similar:
        rows["similar"] = profile["similar"]
    if profile["material"]["kind"] == "molecule":
        cypher = """
            MATCH (m:Material {material_key: $k})-[u:USED_IN]->(a:Application)
            MATCH (o:Material {kind: 'molecule'})-[u2:USED_IN {source_id: u.source_id}]->(a2:Application)
            WHERE o.material_key <> $k
            RETURN o.material_key AS material_key, o.common_name AS common_name, a2.name AS role, count(*) AS shared_sources
            ORDER BY shared_sources DESC LIMIT 10
        """
        res.cypher.append(cypher)
        rows["co_occurring_species"] = [dict(r) for r in session.run(cypher, k=key)]
    res.rows = [rows]
    res.extra = {"material": profile["material"], "properties": profile["properties"], "applications": profile["applications"], "resolution": resolution.model_dump()}
    res.source_ids = sorted({v["source_id"] for v in profile["properties"] if v.get("source_id")})
    return res


# ---------------------------------------------------------------------------
# 4. Literature retrieval (hybrid vector + fulltext, reciprocal-rank fusion)
# ---------------------------------------------------------------------------

def _rrf(rankings: list[list[str]], k: int = 60) -> list[str]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, sid in enumerate(ranking):
            scores[sid] = scores.get(sid, 0.0) + 1.0 / (k + rank + 1)
    return [sid for sid, _ in sorted(scores.items(), key=lambda kv: kv[1], reverse=True)]


def _fulltext_escape(q: str) -> str:
    return __import__("re").sub(r'[+\-&|!(){}\[\]^"~*?:\\/]', " ", q)


def retrieve_sources(session: Session, p: LiteratureParams, embedder=None) -> ToolResult:
    res = ToolResult()
    rankings: list[list[str]] = []
    if embedder is not None:
        vec = embedder.embed_query(p.query)
        cypher = "CALL db.index.vector.queryNodes('source_abstract_embedding', $k, $vec) YIELD node, score RETURN node.source_id AS sid, score"
        res.cypher.append(cypher)
        try:
            rankings.append([r["sid"] for r in session.run(cypher, k=p.k * 2, vec=vec)])
        except Exception as exc:
            res.notes.append(f"vector search unavailable: {exc}")
        cypher_c = "CALL db.index.vector.queryNodes('chunk_embedding', $k, $vec) YIELD node, score RETURN node.source_id AS sid, node.chunk_id AS cid, node.text AS text, score"
        try:
            chunk_rows = [dict(r) for r in session.run(cypher_c, k=p.k, vec=vec)]
            if chunk_rows:
                res.cypher.append(cypher_c)
                res.extra["chunks"] = chunk_rows
                rankings.append([r["sid"] for r in chunk_rows])
        except Exception:
            pass
    cypher_ft = "CALL db.index.fulltext.queryNodes('source_text', $q) YIELD node, score RETURN node.source_id AS sid, score LIMIT $k"
    res.cypher.append(cypher_ft)
    try:
        rankings.append([r["sid"] for r in session.run(cypher_ft, q=_fulltext_escape(p.query), k=p.k * 2)])
    except Exception as exc:
        res.notes.append(f"fulltext search unavailable: {exc}")
    fused = _rrf(rankings)[: p.k]
    if p.since_year:
        years = {r["sid"]: r["y"] for r in session.run("UNWIND $ids AS id MATCH (s:Source {source_id: id}) RETURN id AS sid, s.year AS y", ids=fused)}
        fused = [sid for sid in fused if (years.get(sid) or 0) >= p.since_year]
    res.rows = queries.expand_sources(session, fused) if fused else []
    res.source_ids = fused
    return res


# ---------------------------------------------------------------------------
# 5. Gap / coverage report
# ---------------------------------------------------------------------------

def gap_report(session: Session, p: GapParams) -> ToolResult:
    res = ToolResult()
    application = resolve_application_name(p.application) if p.application else None
    if application:
        coverage = queries.get_application_coverage(session, application)
        res.cypher.append("queries.get_application_coverage")
    else:
        coverage = queries.get_property_coverage(session)
        res.cypher.append("queries.get_property_coverage")
    gaps = queries.gaps_for(session, application)
    res.rows = coverage
    res.extra = {"application": application, "gaps": gaps}
    res.source_ids = sorted({g["source_id"] for g in gaps})
    return res
