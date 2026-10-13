"""Entity resolution: literature formula strings -> Material nodes.

Order, stopping at the first hit:
 1. molecule alias table (LiPF6, EC, PEO...)          -> new_molecule / matched
 2. formula alias table (LLZO, NMC811, LFP...)         -> continue with concrete formula
 3. variable detection (x, y, δ, 1-x)                   -> unresolved_variable
 4. pymatgen parse                                      -> unparseable on failure
 5. canonical reduced formula + graph lookup            -> matched | ambiguous (polymorphs)
 6. doped-variant heuristic against graph materials     -> doped_variant (lit: stub + parent)
 7. else                                                -> new_crystal (lit:<reduced_formula>)

The same resolver serves the harvester, the Liverpool dataset loader and the
GraphRAG entity step, so there is one definition of "same material".
"""

from __future__ import annotations

import math

from materialsgraph import chem
from materialsgraph.harvest.aliases import lookup_formula_alias, lookup_molecule
from materialsgraph.harvest.models import Resolution

ANIONS = {"O", "S", "Se", "F", "Cl", "Br", "I", "N", "P"}
DOPED_MIN_COSINE = 0.90


def lit_key(reduced: str, spacegroup: str | None = None) -> str:
    return f"lit:{reduced}" + (f"|{spacegroup}" if spacegroup else "")


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    keys = set(a) | set(b)
    dot = sum(a.get(k, 0.0) * b.get(k, 0.0) for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def _fractions(comp: dict[str, float]) -> dict[str, float]:
    total = sum(comp.values()) or 1.0
    return {k: v / total for k, v in comp.items()}


def _graph_candidates(session, reduced: str) -> list[dict]:
    from materialsgraph.graph.queries import find_materials_by_formula

    return find_materials_by_formula(session, reduced)


def _graph_materials_sharing_elements(session, elements: set[str], anion: str | None) -> list[dict]:
    """Crystal materials whose element set differs from `elements` by at most two symbols and shares the anion."""
    rows = session.run(
        """
        MATCH (m:Material {kind: 'crystal'})-[c:COMPOSED_OF]->(e:Element)
        WITH m, collect({symbol: e.symbol, amt: c.stoichiometry}) AS comp, collect(e.symbol) AS syms
        WHERE ($anion IS NULL OR $anion IN syms)
          AND size([s IN syms WHERE NOT s IN $elements]) <= 1
          AND size([s IN $elements WHERE NOT s IN syms]) <= 2
          AND size(syms) >= 2
        RETURN m.material_key AS material_key, m.formula AS formula, comp
        LIMIT 200
        """,
        elements=sorted(elements),
        anion=anion,
    )
    return [dict(r) for r in rows]


def resolve_formula(raw: str, session=None, *, spacegroup: str | None = None, allow_doped: bool = True) -> Resolution:
    text = (raw or "").strip()
    if not text:
        return Resolution(status="unparseable", note="empty")

    # 1. molecules
    mol = lookup_molecule(text)
    if mol:
        key = f"mol:{mol['inchikey']}" if mol.get("inchikey") else f"mol:name:{mol['common_name'].lower()}"
        return Resolution(
            status="new_molecule",
            material_key=key,
            kind="molecule",
            inchikey=mol.get("inchikey"),
            smiles=mol.get("smiles"),
            common_name=mol["common_name"],
            reduced_formula=_safe_reduced(mol["formula"]),
            composition=_safe_composition(mol["formula"]),
        )

    # 2. acronyms
    alias = lookup_formula_alias(text)
    if alias:
        text = alias

    # 3. variables
    if chem.has_variable(text):
        return Resolution(status="unresolved_variable", note=f"contains a variable: {raw!r}")

    # 4. parse
    try:
        composition = chem.parse_composition(text)
        reduced = chem.reduced_formula(text)
    except chem.FormulaError as exc:
        return Resolution(status="unparseable", note=str(exc))

    if session is None:
        return Resolution(status="new_crystal", material_key=lit_key(reduced, spacegroup), reduced_formula=reduced, composition=composition)

    # 5. graph lookup
    candidates = _graph_candidates(session, reduced)
    if candidates:
        if spacegroup:
            exact = [c for c in candidates if c.get("spacegroup") == spacegroup]
            if len(exact) == 1:
                return Resolution(status="matched", material_key=exact[0]["material_key"], reduced_formula=reduced, composition=composition)
        if len(candidates) == 1:
            return Resolution(status="matched", material_key=candidates[0]["material_key"], reduced_formula=reduced, composition=composition)
        # several polymorphs: default to the lowest energy_above_hull, flag as ambiguous
        return Resolution(
            status="ambiguous",
            material_key=candidates[0]["material_key"],
            candidates=[c["material_key"] for c in candidates],
            reduced_formula=reduced,
            composition=composition,
            note="several polymorphs; defaulted to lowest energy_above_hull",
        )

    # 6. doped variant of a known phase
    if allow_doped and len(composition) >= 3:
        anion = next((e for e in ("O", "S", "Cl", "Br", "I", "F", "Se", "N", "P") if e in composition), None)
        best_key, best_score = None, 0.0
        target = _fractions(composition)
        for row in _graph_materials_sharing_elements(session, set(composition), anion):
            other = _fractions({c["symbol"]: float(c["amt"]) for c in row["comp"]})
            score = _cosine(target, other)
            if score > best_score:
                best_key, best_score = row["material_key"], score
        if best_key and best_score >= DOPED_MIN_COSINE:
            return Resolution(
                status="doped_variant",
                material_key=lit_key(reduced, spacegroup),
                parent_material_key=best_key,
                parent_score=round(best_score, 4),
                reduced_formula=reduced,
                composition=composition,
            )

    # 7. new stub
    return Resolution(status="new_crystal", material_key=lit_key(reduced, spacegroup), reduced_formula=reduced, composition=composition)


def _safe_reduced(formula: str) -> str | None:
    try:
        return chem.reduced_formula(formula)
    except chem.FormulaError:
        return None


def _safe_composition(formula: str) -> dict[str, float]:
    try:
        return chem.parse_composition(formula)
    except chem.FormulaError:
        return {}


def resolve_for_query(session, raw: str | None, *, material_key: str | None = None) -> Resolution:
    """Resolution for user-typed names in the query layer; works without pymatgen.

    1. an explicit material_key that exists in the graph
    2. graph match on material_key / formula / reduced_formula / common_name (case-insensitive),
       after expanding acronyms through the alias tables
    3. full resolve_formula (pymatgen) when it is importable
    The deployed API ships without pymatgen, so steps 1-2 must cover the UI's pickers.
    """
    if material_key:
        row = session.run("MATCH (m:Material {material_key: $k}) RETURN m.material_key AS k, m.kind AS kind, m.reduced_formula AS rf", k=material_key).single()
        if row:
            return Resolution(status="matched", material_key=row["k"], kind=row["kind"] or "crystal", reduced_formula=row["rf"])
    text = (raw or "").strip()
    if not text:
        return Resolution(status="unparseable", note="empty")
    needles = {text.lower()}
    alias = lookup_formula_alias(text)
    if alias:
        needles.add(alias.lower())
    mol = lookup_molecule(text)
    if mol:
        needles.update({mol["common_name"].lower(), mol["formula"].lower()})
    rows = session.run(
        """
        MATCH (m:Material)
        WHERE toLower(m.material_key) IN $n OR toLower(m.formula) IN $n
           OR toLower(coalesce(m.reduced_formula, '')) IN $n OR toLower(coalesce(m.common_name, '')) IN $n
        OPTIONAL MATCH (m)-[:HAS_PROPERTY]->(pv:PropertyValue {property_type: 'energy_above_hull'})
        RETURN m.material_key AS k, m.kind AS kind, m.reduced_formula AS rf, min(pv.value) AS eah
        ORDER BY eah, k
        """,
        n=sorted(needles),
    ).data()
    if len(rows) == 1:
        r = rows[0]
        return Resolution(status="matched", material_key=r["k"], kind=r["kind"] or "crystal", reduced_formula=r["rf"])
    if len(rows) > 1:
        r = rows[0]
        return Resolution(
            status="ambiguous", material_key=r["k"], kind=r["kind"] or "crystal", reduced_formula=r["rf"],
            candidates=[x["k"] for x in rows], note="several materials match; defaulted to lowest energy_above_hull",
        )
    try:
        import pymatgen.core  # noqa: F401
    except ImportError:
        return Resolution(status="unresolved", note=f"{raw!r} is not in the graph; pick a material from the list")
    return resolve_formula(text, session)
