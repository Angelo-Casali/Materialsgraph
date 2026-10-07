"""Build snapshot pieces from reference data, and the illustrative sample snapshot (no Neo4j needed)."""

from __future__ import annotations

import subprocess
from datetime import datetime, timezone

from materialsgraph import chem
from materialsgraph.enrichment.similarity import top_k_similar
from materialsgraph.graph.reference import (
    APPLICATIONS,
    CRITICAL_ELEMENTS,
    DOMAIN_NAME,
    LOG_SCALE_PROPERTIES,
    PROPERTY_TYPES,
    PROPERTY_UNITS,
    REQUIRED_PROPERTIES,
)
from materialsgraph.harvest.aliases import FORMULA_ALIASES, MOLECULE_ALIASES
from materialsgraph.site import sample_data
from materialsgraph.site.snapshot_models import (
    SAMPLE_KEY_PREFIX,
    SAMPLE_SOURCE_ID,
    CompositionEntry,
    Domain,
    Meta,
    Requirement,
    Similar,
    SnapApplication,
    SnapElement,
    SnapMaterial,
    SnapPropertyType,
    SnapPropertyValue,
    Snapshot,
    SnapSource,
    UsedIn,
)

SIMILAR_METHOD = "composition_cosine_v1"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def git_sha() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5).stdout.strip() or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# reference pieces shared by sample builder and exporter
# ---------------------------------------------------------------------------

def reference_domain() -> Domain:
    return Domain(
        name=DOMAIN_NAME,
        requires=[Requirement(property_type=r["name"], target_min=r["target_min"], target_max=r["target_max"], importance=r["importance"]) for r in REQUIRED_PROPERTIES],
    )


def reference_property_types() -> list[SnapPropertyType]:
    return [
        SnapPropertyType(name=p["name"], unit=p["unit"], description=p["description"] or "", plausible=p["plausible"], log_scale=p["name"] in LOG_SCALE_PROPERTIES)
        for p in PROPERTY_TYPES
    ]


def reference_applications() -> list[SnapApplication]:
    return [
        SnapApplication(
            name=name,
            description=spec.get("description"),
            aliases=spec.get("aliases", []),
            kinds=spec.get("kinds", []),
            requires=[Requirement(**r) for r in spec.get("requires", [])],
        )
        for name, spec in APPLICATIONS.items()
    ]


def reference_elements(symbols: set[str] | None = None) -> list[SnapElement]:
    symbols = set(symbols or set()) | set(CRITICAL_ELEMENTS)
    out = []
    for sym in sorted(symbols):
        spec = CRITICAL_ELEMENTS.get(sym, {})
        out.append(SnapElement(symbol=sym, eu_crm_2023=bool(spec.get("eu_crm_2023")), usgs_2022=bool(spec.get("usgs_2022")), note=spec.get("note") or None))
    return out


def composition_entries(composition: dict[str, float]) -> list[CompositionEntry]:
    total = float(sum(composition.values())) or 1.0
    return [CompositionEntry(symbol=s, stoichiometry=round(a, 4), fraction=round(a / total, 5)) for s, a in composition.items()]


def add_similarity(materials: list[SnapMaterial], *, top_k: int = 3, min_score: float = 0.9) -> None:
    """Composition-cosine neighbours, always confirmed=false (machine suggestion)."""
    for kind in ("crystal", "molecule"):
        vectors = {m.key: {c.symbol: c.fraction for c in m.composition} for m in materials if m.kind == kind and m.composition}
        edges = top_k_similar(vectors, top_k=top_k, min_score=min_score)
        by_key = {m.key: m for m in materials}
        for a, b, score in edges:
            by_key[a].similar.append(Similar(key=b, method=SIMILAR_METHOD, score=score, confirmed=False))


def build_aliases(materials: list[SnapMaterial]) -> dict[str, str]:
    """lower-cased formula / reduced formula / common name / acronym -> material key."""
    aliases: dict[str, str] = {}
    for m in materials:
        for name in (m.formula, m.reduced_formula, m.common_name, m.key):
            if name:
                aliases.setdefault(name.lower(), m.key)
    for acronym, formula in FORMULA_ALIASES.items():
        key = aliases.get(formula.lower())
        if key:
            aliases.setdefault(acronym, key)
    for alias, spec in MOLECULE_ALIASES.items():
        key = aliases.get(spec["common_name"].lower())
        if key:
            aliases.setdefault(alias, key)
            for a in spec.get("aliases", []):
                aliases.setdefault(a.lower(), key)
    return aliases


# ---------------------------------------------------------------------------
# sample
# ---------------------------------------------------------------------------

def _pv(row: tuple) -> SnapPropertyValue:
    prop, value, source_type, conditions, confirmed, note = row
    if prop not in PROPERTY_UNITS:
        raise ValueError(f"sample uses unknown property {prop!r}")
    return SnapPropertyValue(
        property_type=prop, value=float(value), unit=PROPERTY_UNITS[prop], source_type=source_type, confirmed=confirmed,
        source_id=SAMPLE_SOURCE_ID, conditions=conditions, extraction_method="sample:hand-curated", note=note,
    )


def _used(rows: list[tuple]) -> list[UsedIn]:
    out = []
    for app, basis, confirmed in rows:
        if app not in APPLICATIONS:
            raise ValueError(f"sample uses unknown application {app!r}")
        out.append(UsedIn(application=app, basis=basis, confirmed=confirmed, source_id=SAMPLE_SOURCE_ID))
    return out


def build_sample_snapshot() -> Snapshot:
    materials: list[SnapMaterial] = []
    for spec in sample_data.CRYSTALS:
        comp = chem.parse_composition(spec["formula"])
        reduced = chem.reduced_formula(spec["formula"])
        materials.append(
            SnapMaterial(
                key=f"{SAMPLE_KEY_PREFIX}{spec['formula']}", formula=spec["formula"], reduced_formula=reduced, kind="crystal",
                common_name=spec.get("common_name"), spacegroup=spec.get("spacegroup"), structure_type=spec.get("structure_type"),
                license="illustrative-not-for-citation", blurb=spec.get("blurb"), composition=composition_entries(comp),
                properties=[_pv(r) for r in spec["properties"]], used_in=_used(spec["used_in"]),
            )
        )
    for spec in sample_data.MOLECULES:
        mol = MOLECULE_ALIASES[spec["alias"]]
        try:
            comp = chem.parse_composition(mol["formula"])
            reduced = chem.reduced_formula(mol["formula"])
        except chem.FormulaError:
            comp, reduced = {}, mol["formula"]
        materials.append(
            SnapMaterial(
                key=f"{SAMPLE_KEY_PREFIX}mol:{spec['name']}", formula=mol["formula"], reduced_formula=reduced, kind="molecule",
                common_name=mol["common_name"], smiles=mol.get("smiles"), inchikey=mol.get("inchikey"),
                license="illustrative-not-for-citation", blurb=spec.get("blurb"), composition=composition_entries(comp),
                properties=[_pv(r) for r in spec["properties"]], used_in=_used(spec["used_in"]),
            )
        )
    keys = [m.key for m in materials]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate sample keys")
    add_similarity(materials)
    symbols = {c.symbol for m in materials for c in m.composition}
    snap = Snapshot(
        meta=Meta(generated_at=now_iso(), generator="materialsgraph.site.build_sample_snapshot", git_sha=git_sha(), sample=True, notice=sample_data.NOTICE),
        domain=reference_domain(),
        property_types=reference_property_types(),
        applications=reference_applications(),
        elements=reference_elements(symbols),
        sources=[SnapSource(**sample_data.SAMPLE_SOURCE)],
        materials=materials,
        gaps=[],
        aliases=build_aliases(materials),
    )
    snap.recount()
    return snap
