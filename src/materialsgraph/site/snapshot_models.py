"""Snapshot schema shared by the exporter, the importer and the website.

The pydantic models are the source of truth; `python -m materialsgraph.site.snapshot_models
--json-schema PATH` writes the JSON Schema the web app validates against.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = 1
SAMPLE_SOURCE_ID = "sample:illustrative"
SAMPLE_KEY_PREFIX = "sample:"

PVSourceType = Literal["measured", "dft", "mlip_predicted", "literature_asserted"]
SourceKind = Literal["paper", "preprint", "book", "video", "database"]


class Requirement(BaseModel):
    property_type: str
    target_min: float | None = None
    target_max: float | None = None
    importance: Literal["high", "medium", "low"] = "medium"


class SnapPropertyValue(BaseModel):
    property_type: str
    value: float
    unit: str
    source_type: PVSourceType
    confirmed: bool
    source_id: str
    conditions: str = ""
    extraction_method: str | None = None
    quote: str | None = None
    note: str | None = None


class CompositionEntry(BaseModel):
    symbol: str
    stoichiometry: float
    fraction: float


class UsedIn(BaseModel):
    application: str
    basis: Literal["computed", "literature", "curated"]
    confirmed: bool
    source_id: str


class Similar(BaseModel):
    key: str
    method: str
    score: float
    confirmed: bool


class SnapMaterial(BaseModel):
    key: str
    formula: str
    reduced_formula: str
    kind: Literal["crystal", "molecule"]
    common_name: str | None = None
    spacegroup: str | None = None
    structure_type: str | None = None
    mp_id: str | None = None
    smiles: str | None = None
    inchikey: str | None = None
    license: str | None = None
    blurb: str | None = None
    composition: list[CompositionEntry] = Field(default_factory=list)
    properties: list[SnapPropertyValue] = Field(default_factory=list)
    used_in: list[UsedIn] = Field(default_factory=list)
    similar: list[Similar] = Field(default_factory=list)


class SnapPropertyType(BaseModel):
    name: str
    unit: str
    description: str
    plausible: tuple[float, float]
    log_scale: bool = False


class SnapApplication(BaseModel):
    name: str
    description: str | None = None
    aliases: list[str] = Field(default_factory=list)
    kinds: list[Literal["crystal", "molecule"]] = Field(default_factory=list)
    requires: list[Requirement] = Field(default_factory=list)


class SnapElement(BaseModel):
    symbol: str
    eu_crm_2023: bool = False
    usgs_2022: bool = False
    note: str | None = None


class SnapSource(BaseModel):
    source_id: str
    title: str
    type: SourceKind
    year: int | None = None
    doi: str | None = None
    url: str | None = None
    license: str | None = None
    citable: bool = True


class SnapGap(BaseModel):
    gap_id: str
    description: str
    application: str | None = None
    status: Literal["open", "addressed"] = "open"
    confirmed: bool = False
    source_id: str


class Domain(BaseModel):
    name: str
    requires: list[Requirement] = Field(default_factory=list)


class Meta(BaseModel):
    schema_version: int = SCHEMA_VERSION
    generated_at: str
    generator: str
    git_sha: str | None = None
    sample: bool
    notice: str
    counts: dict[str, int] = Field(default_factory=dict)


class Snapshot(BaseModel):
    meta: Meta
    domain: Domain
    property_types: list[SnapPropertyType]
    applications: list[SnapApplication]
    elements: list[SnapElement]
    sources: list[SnapSource]
    materials: list[SnapMaterial]
    gaps: list[SnapGap] = Field(default_factory=list)
    aliases: dict[str, str] = Field(default_factory=dict)  # lower-cased formula/acronym/name -> material key

    def recount(self) -> None:
        self.meta.counts = {
            "materials": len(self.materials),
            "property_values": sum(len(m.properties) for m in self.materials),
            "sources": len(self.sources),
            "gaps": len(self.gaps),
            "used_in": sum(len(m.used_in) for m in self.materials),
            "similar": sum(len(m.similar) for m in self.materials),
        }

    def write(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.model_dump_json(indent=1, exclude_none=True))
        return path

    @classmethod
    def read(cls, path: str | Path) -> "Snapshot":
        return cls.model_validate_json(Path(path).read_text())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Emit the snapshot JSON Schema")
    parser.add_argument("--json-schema", required=True, help="output path")
    args = parser.parse_args(argv)
    out = Path(args.json_schema)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(Snapshot.model_json_schema(), indent=1))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
