"""Deterministic unit normalisation for extracted property values.

Local 8-14B models routinely confuse mS/cm with S/cm or drop an exponent; a
rule-based normaliser plus the plausible-range check in validate.py catches
most of it. Unknown units return None so the candidate goes to review rather
than being silently written.
"""

from __future__ import annotations

import re

from materialsgraph.graph.reference import PROPERTY_UNITS

_SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")


def _canon(unit: str) -> str:
    u = unit.strip().translate(_SUPERSCRIPTS)
    u = u.replace("·", " ").replace("•", " ").replace("−", "-").replace("µ", "u").replace("μ", "u")
    u = u.replace("°", "deg").replace("℃", "degC")
    u = re.sub(r"\s+", " ", u).strip().lower()
    u = u.replace(" ", "")
    return u


# property -> {canonical unit spelling: factor to canonical}
_FACTORS: dict[str, dict[str, float]] = {
    "ionic_conductivity": {
        "s/cm": 1.0, "scm-1": 1.0, "scm^-1": 1.0, "s·cm-1": 1.0, "s.cm-1": 1.0, "siemens/cm": 1.0,
        "ms/cm": 1e-3, "mscm-1": 1e-3, "mscm^-1": 1e-3,
        "us/cm": 1e-6, "uscm-1": 1e-6,
        "s/m": 1e-2, "sm-1": 1e-2, "sm^-1": 1e-2,
        "ms/m": 1e-5,
    },
    "voltage": {"v": 1.0, "volt": 1.0, "volts": 1.0, "vvsli/li+": 1.0, "vvs.li/li+": 1.0, "vvsli+/li": 1.0, "mv": 1e-3},
    "specific_capacity": {"mah/g": 1.0, "mahg-1": 1.0, "mahg^-1": 1.0, "mah·g-1": 1.0, "ah/kg": 1.0, "ah/g": 1000.0},
    "band_gap": {"ev": 1.0, "mev": 1e-3},
    "formation_energy": {"ev/atom": 1.0, "evatom-1": 1.0, "mev/atom": 1e-3},
    "energy_above_hull": {"ev/atom": 1.0, "evatom-1": 1.0, "mev/atom": 1e-3},
    "activation_energy": {"ev": 1.0, "mev": 1e-3, "kj/mol": 1.0 / 96.485},
    "cycling_stability": {"%": 1.0, "percent": 1.0, "%retention": 1.0},
    "electrochemical_window": {"v": 1.0},
    "density": {"g/cm3": 1.0, "gcm-3": 1.0, "g/cc": 1.0, "kg/m3": 1e-3},
    "melting_point": {"k": 1.0, "degc": None, "c": None},  # None = affine, handled below
    "boiling_point": {"k": 1.0, "degc": None, "c": None},
    "dielectric_constant": {"": 1.0, "-": 1.0, "dimensionless": 1.0},
    "viscosity": {"mpa.s": 1.0, "mpas": 1.0, "cp": 1.0, "pa.s": 1000.0, "pas": 1000.0},
    "oxidation_potential": {"v": 1.0, "vvsli/li+": 1.0, "vvs.li/li+": 1.0},
    "molecular_weight": {"g/mol": 1.0, "gmol-1": 1.0, "da": 1.0},
}


def normalize_value(value: float, unit_raw: str, property_type: str) -> tuple[float, str] | None:
    """Return (value in canonical unit, canonical unit) or None when the unit is unknown for that property."""
    if property_type not in PROPERTY_UNITS:
        return None
    canonical_unit = PROPERTY_UNITS[property_type]
    table = _FACTORS.get(property_type, {})
    key = _canon(unit_raw or "")
    if key in ("", "none") and canonical_unit == "":
        return float(value), canonical_unit
    if key not in table:
        # allow the canonical spelling itself
        if key == _canon(canonical_unit):
            return float(value), canonical_unit
        return None
    factor = table[key]
    if factor is None:  # temperature in Celsius
        return float(value) + 273.15, canonical_unit
    return float(value) * factor, canonical_unit


_TEMP_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*(?:°|deg)?\s*(c|k|℃)\b", re.IGNORECASE)
_RT_RE = re.compile(r"\b(room temperature|rt|ambient)\b", re.IGNORECASE)


def parse_conditions(text: str) -> dict:
    """Pull a temperature (K) out of a free-text conditions string, keep the raw text too."""
    out: dict = {}
    if not text:
        return out
    m = _TEMP_RE.search(text)
    if m:
        val = float(m.group(1))
        unit = m.group(2).lower()
        out["temperature_K"] = round(val + 273.15, 2) if unit in ("c", "℃") else val
    elif _RT_RE.search(text):
        out["temperature_K"] = 298.0
    out["raw"] = text.strip()
    return out
