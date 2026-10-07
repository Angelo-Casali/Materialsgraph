"""Reference data and constants shared across ingestion, harvesting and querying.

Deliberately free of heavy imports (no neo4j, pymatgen, mp_api) so that
read-only code paths -- queries, the GraphRAG layer, unit tests -- can import
it without dragging in the whole ingestion stack.

Everything here is *reference data* in the sense of CLAUDE.md: new
PropertyTypes, Applications and Domain targets are added here rather than as
new top-level node labels.
"""

from __future__ import annotations

DOMAIN_NAME = "Battery"

# ---------------------------------------------------------------------------
# Source nodes that are seeded once (databases / lists, not papers)
# ---------------------------------------------------------------------------
MP_SOURCE_ID = "materials-project"
OQMD_SOURCE_ID = "oqmd"
LIVERPOOL_SOURCE_ID = "liverpool-liion-database"
PUBCHEM_SOURCE_ID = "pubchem"
EU_CRM_SOURCE_ID = "eu-crm-2023"
USGS_SOURCE_ID = "usgs-critical-minerals-2022"

SEED_SOURCES = [
    {
        "source_id": MP_SOURCE_ID,
        "title": "Materials Project",
        "type": "database",
        "url_or_doi": "https://materialsproject.org",
        "license": "CC-BY-4.0",
        "provider": "materials_project",
    },
    {
        "source_id": OQMD_SOURCE_ID,
        "title": "Open Quantum Materials Database (via OPTIMADE)",
        "type": "database",
        "url_or_doi": "https://oqmd.org/optimade/v1",
        "license": None,  # filled from /v1/info at ingest time
        "provider": "oqmd",
    },
    {
        "source_id": LIVERPOOL_SOURCE_ID,
        "title": "Liverpool Ionics Dataset (Li-ion solid electrolyte conductivities)",
        "type": "database",
        "url_or_doi": "https://github.com/lrcfmd/LiIonDatabase",
        "license": None,  # verified at ingest time, see ingestion/liverpool_ionics.py
        "provider": "liverpool",
    },
    {
        "source_id": PUBCHEM_SOURCE_ID,
        "title": "PubChem",
        "type": "database",
        "url_or_doi": "https://pubchem.ncbi.nlm.nih.gov",
        "license": "public-domain",
        "provider": "pubchem",
    },
    {
        "source_id": EU_CRM_SOURCE_ID,
        "title": "EU Critical Raw Materials list 2023",
        "type": "database",
        "url_or_doi": "https://single-market-economy.ec.europa.eu/sectors/raw-materials/areas-specific-interest/critical-raw-materials_en",
        "license": "public-document",
        "provider": "eu",
    },
    {
        "source_id": USGS_SOURCE_ID,
        "title": "USGS 2022 Final List of Critical Minerals",
        "type": "database",
        "url_or_doi": "https://www.usgs.gov/news/national-news-release/us-geological-survey-releases-2022-list-critical-minerals",
        "license": "public-document",
        "provider": "usgs",
    },
]

SOURCE_TYPES = ("paper", "preprint", "book", "video", "database")
PV_SOURCE_TYPES = ("measured", "dft", "mlip_predicted", "literature_asserted")
MATERIAL_KINDS = ("crystal", "molecule")
USED_IN_BASES = ("computed", "literature", "curated")

# ---------------------------------------------------------------------------
# PropertyTypes. plausible_min/max are *sanity* bounds used by the harvester
# validator to reject obviously wrong extractions (unit confusion, exponent
# errors); they are not physical limits.
# ---------------------------------------------------------------------------
PROPERTY_TYPES: list[dict] = [
    {"name": "band_gap", "unit": "eV", "description": "electronic band gap", "plausible": (0.0, 15.0)},
    {"name": "formation_energy", "unit": "eV/atom", "description": "formation energy per atom", "plausible": (-6.0, 2.0)},
    {
        "name": "energy_above_hull",
        "unit": "eV/atom",
        "description": "distance above the convex hull; 0 = ground-state stable",
        "plausible": (0.0, 2.0),
    },
    {"name": "voltage", "unit": "V", "description": "average (dis)charge voltage vs the working ion", "plausible": (-1.0, 6.0)},
    {"name": "specific_capacity", "unit": "mAh/g", "description": "gravimetric specific capacity", "plausible": (0.0, 4000.0)},
    {"name": "ionic_conductivity", "unit": "S/cm", "description": "ionic conductivity (room temperature unless conditions say otherwise)", "plausible": (1e-12, 1.0)},
    {
        "name": "cycling_stability",
        "unit": "% retention",
        "description": "capacity retention after N cycles",
        "plausible": (0.0, 100.0),
    },
    {"name": "electrochemical_window", "unit": "V", "description": "electrochemical stability window width", "plausible": (0.0, 10.0)},
    {"name": "activation_energy", "unit": "eV", "description": "activation energy for ion migration", "plausible": (0.0, 3.0)},
    {"name": "density", "unit": "g/cm3", "description": "mass density", "plausible": (0.1, 25.0)},
    # molecule-oriented (liquid electrolyte components)
    {"name": "melting_point", "unit": "K", "description": "melting point", "plausible": (0.0, 2000.0)},
    {"name": "boiling_point", "unit": "K", "description": "boiling point", "plausible": (0.0, 2000.0)},
    {"name": "dielectric_constant", "unit": "", "description": "relative permittivity", "plausible": (1.0, 200.0)},
    {"name": "viscosity", "unit": "mPa.s", "description": "dynamic viscosity", "plausible": (0.0, 10000.0)},
    {"name": "oxidation_potential", "unit": "V vs Li/Li+", "description": "anodic stability limit", "plausible": (0.0, 8.0)},
    {"name": "molecular_weight", "unit": "g/mol", "description": "molecular weight", "plausible": (1.0, 100000.0)},
]
PROPERTY_UNITS: dict[str, str] = {p["name"]: p["unit"] for p in PROPERTY_TYPES}
PROPERTY_PLAUSIBLE: dict[str, tuple[float, float]] = {p["name"]: p["plausible"] for p in PROPERTY_TYPES}
# Properties compared on a log scale when checking whether sources "disagree".
LOG_SCALE_PROPERTIES = {"ionic_conductivity", "viscosity"}

# Domain-level requirements (kept for backwards compatibility with the first
# loader; Application-level requirements below are what the feasibility tool
# prefers).
REQUIRED_PROPERTIES = [
    {"name": "ionic_conductivity", "target_min": 1e-4, "target_max": None, "importance": "high"},
    {"name": "voltage", "target_min": None, "target_max": None, "importance": "high"},
    {"name": "specific_capacity", "target_min": None, "target_max": None, "importance": "high"},
]

# Properties Materials Project computes via DFT for every record we pull.
DFT_PROPERTIES = ["band_gap", "formation_energy", "energy_above_hull"]
# Properties that only exist for the id_discharge compound in an electrode.
ELECTRODE_PROPERTIES = ["voltage", "specific_capacity"]

# ---------------------------------------------------------------------------
# Applications. `aliases` feed the resolver (literature strings -> canonical
# name); `requires` are illustrative, reviewer-editable targets used by the
# feasibility use case. `kind` says which Material kinds the tag makes sense for.
# ---------------------------------------------------------------------------
WORKING_IONS = ["Li", "Na", "K", "Mg"]


def insertion_electrode_application(ion: str) -> str:
    return f"{ion}-ion insertion electrode"


APPLICATIONS: dict[str, dict] = {
    **{
        insertion_electrode_application(ion): {
            "aliases": [f"{ion.lower()}-ion electrode", f"{ion} insertion electrode"],
            "kinds": ["crystal"],
            "requires": [],
            "description": f"Computationally enumerated {ion} insertion electrode (Materials Project).",
        }
        for ion in WORKING_IONS
    },
    "Li-ion cathode": {
        "aliases": ["lithium-ion cathode", "li-ion cathode material", "cathode", "positive electrode", "lithium cathode"],
        "kinds": ["crystal"],
        "requires": [
            {"property_type": "voltage", "target_min": 3.0, "target_max": 4.6, "importance": "high"},
            {"property_type": "specific_capacity", "target_min": 150.0, "target_max": None, "importance": "high"},
            {"property_type": "energy_above_hull", "target_min": None, "target_max": 0.05, "importance": "medium"},
        ],
    },
    "Na-ion cathode": {
        "aliases": ["sodium-ion cathode", "na-ion cathode material", "sodium cathode"],
        "kinds": ["crystal"],
        "requires": [
            {"property_type": "voltage", "target_min": 2.5, "target_max": 4.3, "importance": "high"},
            {"property_type": "specific_capacity", "target_min": 100.0, "target_max": None, "importance": "high"},
            {"property_type": "energy_above_hull", "target_min": None, "target_max": 0.05, "importance": "medium"},
        ],
    },
    "anode material": {
        "aliases": ["anode", "negative electrode", "li-ion anode", "lithium anode material"],
        "kinds": ["crystal"],
        "requires": [
            {"property_type": "voltage", "target_min": None, "target_max": 1.0, "importance": "high"},
            {"property_type": "specific_capacity", "target_min": 300.0, "target_max": None, "importance": "high"},
        ],
    },
    "solid electrolyte": {
        "aliases": [
            "solid-state electrolyte", "solid state electrolyte", "sse", "inorganic solid electrolyte",
            "superionic conductor", "lithium superionic conductor", "li-ion conductor", "sulfide electrolyte",
            "halide electrolyte", "oxide electrolyte", "garnet electrolyte", "argyrodite",
        ],
        "kinds": ["crystal"],
        "requires": [
            {"property_type": "ionic_conductivity", "target_min": 1e-4, "target_max": None, "importance": "high"},
            {"property_type": "energy_above_hull", "target_min": None, "target_max": 0.05, "importance": "high"},
            {"property_type": "band_gap", "target_min": 3.0, "target_max": None, "importance": "medium"},
        ],
    },
    "polymer electrolyte host": {
        "aliases": ["polymer electrolyte", "solid polymer electrolyte", "spe", "peo electrolyte"],
        "kinds": ["molecule"],
        "requires": [
            {"property_type": "ionic_conductivity", "target_min": 1e-4, "target_max": None, "importance": "high"},
        ],
    },
    "liquid electrolyte solvent": {
        "aliases": ["electrolyte solvent", "carbonate solvent", "solvent", "co-solvent"],
        "kinds": ["molecule"],
        "requires": [
            {"property_type": "dielectric_constant", "target_min": 20.0, "target_max": None, "importance": "medium"},
            {"property_type": "oxidation_potential", "target_min": 4.5, "target_max": None, "importance": "medium"},
        ],
    },
    "electrolyte salt": {
        "aliases": ["lithium salt", "conducting salt", "salt", "li salt"],
        "kinds": ["molecule"],
        "requires": [],
    },
    "electrolyte additive": {
        "aliases": ["additive", "sei-forming additive", "film-forming additive", "flame retardant additive"],
        "kinds": ["molecule"],
        "requires": [],
    },
}

# Backwards-compatible alias: the first loader tagged materials with this name.
APPLICATION_NAME = insertion_electrode_application("Li")

# ---------------------------------------------------------------------------
# Critical-element flags. Hand-encoded from two public documents:
#   - EU Critical Raw Materials Act list, 2023 (34 CRMs; "strategic" subset)
#   - USGS 2022 Final List of Critical Minerals (50 minerals)
# Only elements likely to appear in battery materials are listed; the rest
# default to False. "C" is flagged for natural graphite.
# ---------------------------------------------------------------------------
CRITICAL_ELEMENTS: dict[str, dict] = {
    "Li": {"eu_crm_2023": True, "usgs_2022": True, "note": "battery-grade lithium; EU strategic"},
    "Co": {"eu_crm_2023": True, "usgs_2022": True, "note": "EU strategic"},
    "Ni": {"eu_crm_2023": True, "usgs_2022": True, "note": "battery-grade nickel; EU strategic"},
    "Mn": {"eu_crm_2023": True, "usgs_2022": True, "note": "battery-grade manganese; EU strategic"},
    "C": {"eu_crm_2023": True, "usgs_2022": True, "note": "natural graphite"},
    "P": {"eu_crm_2023": True, "usgs_2022": False, "note": "phosphorus / phosphate rock (EU)"},
    "Cu": {"eu_crm_2023": True, "usgs_2022": False, "note": "EU strategic (2023 addition)"},
    "Al": {"eu_crm_2023": True, "usgs_2022": True, "note": "bauxite/alumina"},
    "Mg": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Ti": {"eu_crm_2023": True, "usgs_2022": True, "note": "titanium metal"},
    "V": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Nb": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Ta": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "W": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Ga": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Ge": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Sb": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Bi": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Sc": {"eu_crm_2023": True, "usgs_2022": True, "note": ""},
    "Si": {"eu_crm_2023": True, "usgs_2022": False, "note": "silicon metal (EU)"},
    "Sr": {"eu_crm_2023": True, "usgs_2022": False, "note": ""},
    "F": {"eu_crm_2023": True, "usgs_2022": True, "note": "fluorspar"},
    "B": {"eu_crm_2023": True, "usgs_2022": False, "note": "borates"},
    "Zr": {"eu_crm_2023": False, "usgs_2022": True, "note": ""},
    "Sn": {"eu_crm_2023": False, "usgs_2022": True, "note": ""},
    "Zn": {"eu_crm_2023": False, "usgs_2022": True, "note": ""},
    "Cr": {"eu_crm_2023": False, "usgs_2022": True, "note": ""},
    "In": {"eu_crm_2023": False, "usgs_2022": True, "note": ""},
    "Te": {"eu_crm_2023": False, "usgs_2022": True, "note": ""},
    "La": {"eu_crm_2023": True, "usgs_2022": True, "note": "rare earth"},
    "Ce": {"eu_crm_2023": True, "usgs_2022": True, "note": "rare earth"},
    "Y": {"eu_crm_2023": True, "usgs_2022": True, "note": "rare earth"},
    "Nd": {"eu_crm_2023": True, "usgs_2022": True, "note": "rare earth"},
}


def critical_flags(symbol: str) -> dict:
    entry = CRITICAL_ELEMENTS.get(symbol, {})
    return {
        "eu_crm_2023": bool(entry.get("eu_crm_2023", False)),
        "usgs_2022": bool(entry.get("usgs_2022", False)),
        "supply_risk_note": entry.get("note") or None,
    }


def resolve_application_name(raw: str | None) -> str | None:
    """Map a free-text application string onto a canonical Application name.

    Exact (case-insensitive) match on the canonical name or an alias; falls back
    to a conservative substring test so e.g. "garnet-type solid electrolyte"
    still resolves. Returns None when nothing matches -- the caller decides
    whether to drop the candidate or send it to review.
    """
    if not raw:
        return None
    needle = raw.strip().lower()
    if not needle:
        return None
    for name, spec in APPLICATIONS.items():
        if needle == name.lower() or needle in (a.lower() for a in spec["aliases"]):
            return name
    # substring fallback, longest alias first so "solid electrolyte" beats "electrolyte salt" ordering issues
    scored: list[tuple[int, str]] = []
    for name, spec in APPLICATIONS.items():
        for alias in [name, *spec["aliases"]]:
            alias_l = alias.lower()
            if len(alias_l) >= 5 and alias_l in needle:
                scored.append((len(alias_l), name))
    if scored:
        scored.sort(reverse=True)
        return scored[0][1]
    return None
