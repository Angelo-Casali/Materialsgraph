"""Pydantic records exchanged between ingestion connectors and the loader.

Kept free of mp_api / pymatgen imports so the loader, queries and tests can
import them cheaply.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class RawMaterialRecord(BaseModel):
    """One Materials Project material as pulled by ingestion/mp_client.py."""

    mp_id: str
    formula: str
    material_key: str | None = None  # "mp:<mp_id>"; filled by mp_client, defaulted below for legacy files
    reduced_formula: str | None = None
    spacegroup: str | None = None
    spacegroup_number: int | None = None
    composition: dict[str, float] = Field(default_factory=dict)  # element -> amount per formula unit
    is_stable: bool | None = None
    band_gap: float | None = None
    formation_energy: float | None = None
    energy_above_hull: float | None = None
    voltage: float | None = None
    specific_capacity: float | None = None
    working_ion: str
    data_source: str
    license: str | None = None
    # ionic_conductivity is deliberately absent: MP doesn't broadly compute it,
    # and the gap should stay visible in the graph rather than be papered over.

    def key(self) -> str:
        return self.material_key or f"mp:{self.mp_id}"


class ExternalPropertyRecord(BaseModel):
    """One structure from an OPTIMADE provider (OQMD, AFLOW, JARVIS, NOMAD...)."""

    provider: str
    provider_id: str
    formula: str
    reduced_formula: str
    spacegroup_number: int | None = None
    composition: dict[str, float] = Field(default_factory=dict)
    properties: dict[str, float] = Field(default_factory=dict)  # canonical PropertyType name -> value
    license: str | None = None
    url: str | None = None

    def key(self) -> str:
        return f"{self.provider}:{self.provider_id}"


class MeasuredPropertyRecord(BaseModel):
    """One measured value from a curated experimental dataset (e.g. Liverpool ionics)."""

    formula_raw: str
    reduced_formula: str | None = None
    property_type: str
    value: float
    unit: str
    conditions: dict = Field(default_factory=dict)  # e.g. {"temperature_K": 298}
    doi: str | None = None
    source_id: str  # per-paper DOI source when available, else dataset source
    title: str | None = None
    year: int | None = None
    dataset_source_id: str


class MoleculeRecord(BaseModel):
    """One molecular species (electrolyte solvent/salt/additive/polymer host)."""

    common_name: str
    formula: str
    inchikey: str
    smiles: str | None = None
    cid: int | None = None
    molecular_weight: float | None = None
    roles: list[str] = Field(default_factory=list)  # canonical Application names
    aliases: list[str] = Field(default_factory=list)

    def key(self) -> str:
        return f"mol:{self.inchikey}"
