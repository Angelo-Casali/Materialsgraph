"""Small chemistry helpers around pymatgen, imported lazily.

Everything that needs to turn a formula string into a canonical composition
goes through here so there is exactly one place that decides what "the same
material" means at the formula level: pymatgen's reduced formula.
"""

from __future__ import annotations

import re

VARIABLE_RE = re.compile(r"(?<![A-Za-z])(x|y|z|δ|d)(?![a-z])|\(1\s*[-−]\s*x\)|1\s*[-−]\s*x")
# Unicode subscripts / minus signs that show up in copied formulas
_SUBSCRIPTS = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")


class FormulaError(ValueError):
    pass


def clean_formula(raw: str) -> str:
    """Normalise whitespace, unicode subscripts and common decorations ("LiFePO4 (LFP)")."""
    text = raw.strip().translate(_SUBSCRIPTS)
    text = text.replace("−", "-").replace("·", ".").replace("•", ".")
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"\(([A-Za-z]{2,10})\)$", "", text)  # trailing acronym in parentheses
    return text


def has_variable(raw: str) -> bool:
    """True for doped/solid-solution formulas written with x, y, δ (e.g. Li1-xNi..., LLZO-δ)."""
    return bool(VARIABLE_RE.search(clean_formula(raw)))


def parse_composition(raw: str) -> dict[str, float]:
    """Formula string -> {element: amount}. Raises FormulaError when pymatgen cannot parse it."""
    from pymatgen.core import Composition  # lazy

    text = clean_formula(raw)
    if not text:
        raise FormulaError("empty formula")
    try:
        comp = Composition(text)
    except Exception as exc:  # pymatgen raises several error types
        raise FormulaError(f"cannot parse {raw!r}: {exc}") from exc
    if comp.num_atoms <= 0 or comp.num_atoms > 500:
        raise FormulaError(f"implausible atom count in {raw!r}")
    return {str(el): float(amt) for el, amt in comp.get_el_amt_dict().items()}


def reduced_formula(raw: str) -> str:
    """Canonical reduced formula (e.g. 'FeLiO4P' -> 'LiFePO4')."""
    from pymatgen.core import Composition  # lazy

    text = clean_formula(raw)
    try:
        return Composition(text).reduced_formula
    except Exception as exc:
        raise FormulaError(f"cannot parse {raw!r}: {exc}") from exc


def composition_from_dict(d: dict[str, float]) -> str:
    from pymatgen.core import Composition  # lazy

    return Composition(d).reduced_formula


def element_fraction_vector(composition: dict[str, float], symbols: list[str]) -> list[float]:
    """Normalised element-fraction vector over a fixed symbol ordering (for SIMILAR_TO)."""
    total = float(sum(composition.values())) or 1.0
    return [float(composition.get(sym, 0.0)) / total for sym in symbols]
