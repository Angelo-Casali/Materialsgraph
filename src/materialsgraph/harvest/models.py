"""Staging records for the literature harvester.

Nothing here touches Neo4j. Candidates live in a JSONL review queue until a
human accepts them (harvest/review_cli.py); harvest/commit.py is the only
module that turns them into graph writes.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter

CandidateKind = Literal["material", "property_value", "used_in", "gap"]
CandidateStatus = Literal["pending", "accepted", "rejected", "needs_edit"]
SourceType = Literal["paper", "preprint", "book", "video", "database"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_id(*parts: str, length: int = 12) -> str:
    text = "|".join(p.strip().lower() for p in parts)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:length]


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

class SourceRecord(BaseModel):
    source_id: str  # "doi:10.xxxx/..." | "openalex:W..." | "arxiv:2501.01234" | "s2:<paperId>"
    doi: str | None = None
    openalex_id: str | None = None
    arxiv_id: str | None = None
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    type: SourceType = "paper"
    abstract: str | None = None
    url_or_doi: str
    license: str | None = None
    is_oa: bool | None = None
    oa_pdf_url: str | None = None
    provider: str
    retrieved_at: str = Field(default_factory=now_iso)
    citation_count: int | None = None
    venue: str | None = None

    def text_for_extraction(self) -> str:
        return f"{self.title}\n\n{self.abstract or ''}".strip()


class TextChunk(BaseModel):
    chunk_id: str
    source_id: str
    text: str
    ordinal: int
    section: str | None = None
    page: int | None = None


# ---------------------------------------------------------------------------
# Validation / resolution / review metadata
# ---------------------------------------------------------------------------

class Check(BaseModel):
    name: str
    ok: bool
    detail: str | None = None


class ValidationResult(BaseModel):
    ok: bool
    checks: list[Check] = Field(default_factory=list)
    cloud_verdict: str | None = None  # "supported" | "unsupported" | "uncertain" from the Claude pass
    cloud_note: str | None = None


ResolutionStatus = Literal[
    "matched", "ambiguous", "new_crystal", "new_molecule", "doped_variant",
    "unresolved_variable", "unparseable", "unresolved",
]


class Resolution(BaseModel):
    status: ResolutionStatus
    material_key: str | None = None
    parent_material_key: str | None = None
    parent_score: float | None = None
    candidates: list[str] = Field(default_factory=list)
    reduced_formula: str | None = None
    composition: dict[str, float] = Field(default_factory=dict)
    kind: Literal["crystal", "molecule"] = "crystal"
    inchikey: str | None = None
    smiles: str | None = None
    common_name: str | None = None
    note: str | None = None


class ReviewDecision(BaseModel):
    status: CandidateStatus
    reviewed_at: str = Field(default_factory=now_iso)
    note: str | None = None
    edits: dict = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------

class CandidateBase(BaseModel):
    candidate_id: str = ""
    kind: CandidateKind
    source_id: str
    quote: str = ""
    extraction_method: str = ""
    llm_confidence: float | None = None
    status: CandidateStatus = "pending"
    validation: ValidationResult | None = None
    resolution: Resolution | None = None
    review: ReviewDecision | None = None
    chunk_id: str | None = None  # set when extracted from a full-text chunk rather than the abstract
    written: bool = False  # True once commit.py has written it (as pending or accepted)

    def ensure_id(self) -> None:
        if not self.candidate_id:
            self.candidate_id = stable_id(self.kind, self.source_id, self.identity())

    def identity(self) -> str:  # pragma: no cover - overridden
        return self.quote


class CandidateMaterial(CandidateBase):
    kind: Literal["material"] = "material"
    formula_raw: str
    material_kind: Literal["crystal", "molecule"] = "crystal"
    common_name: str | None = None
    spacegroup: str | None = None
    smiles: str | None = None
    inchikey: str | None = None

    def identity(self) -> str:
        return normalize_ws(self.formula_raw)


class CandidatePropertyValue(CandidateBase):
    kind: Literal["property_value"] = "property_value"
    formula_raw: str
    property_type: str
    value: float
    unit_raw: str
    value_norm: float | None = None
    unit_norm: str | None = None
    conditions: str = ""  # JSON string, e.g. {"temperature_K": 298}
    source_type: Literal["measured", "dft", "literature_asserted"] = "literature_asserted"

    def identity(self) -> str:
        return f"{normalize_ws(self.formula_raw)}|{self.property_type}|{self.value}|{normalize_ws(self.unit_raw)}|{self.conditions}"


class CandidateUsedIn(CandidateBase):
    kind: Literal["used_in"] = "used_in"
    formula_raw: str
    application_raw: str
    application: str | None = None  # resolved canonical name

    def identity(self) -> str:
        return f"{normalize_ws(self.formula_raw)}|{normalize_ws(self.application_raw)}"


class CandidateGap(CandidateBase):
    kind: Literal["gap"] = "gap"
    description: str
    domain: str = "Battery"
    application: str | None = None
    gap_id: str = ""

    def identity(self) -> str:
        return normalize_ws(self.description)

    def ensure_id(self) -> None:
        if not self.gap_id:
            self.gap_id = "gap:" + stable_id(self.description)
        super().ensure_id()


Candidate = Annotated[
    Union[CandidateMaterial, CandidatePropertyValue, CandidateUsedIn, CandidateGap],
    Field(discriminator="kind"),
]
CandidateAdapter: TypeAdapter = TypeAdapter(Candidate)


def parse_candidate(data: dict):
    return CandidateAdapter.validate_python(data)


# ---------------------------------------------------------------------------
# LLM-facing extraction schema (no ids, status, validation -- extract.py fills those)
# ---------------------------------------------------------------------------

class LLMMaterial(BaseModel):
    formula: str = Field(description="Chemical formula exactly as written in the text, e.g. Li7La3Zr2O12 or LiPF6")
    material_kind: Literal["crystal", "molecule"] = Field(description="'molecule' for solvents, salts, additives, polymers; else 'crystal'")
    common_name: str | None = Field(default=None, description="Acronym or trade name used in the text, e.g. LLZO, LFP, EC")


class LLMPropertyValue(BaseModel):
    formula: str = Field(description="Formula or name of the material the value refers to")
    property_type: str = Field(description="One of the allowed property names given in the instructions")
    value: float = Field(description="Numeric value as a plain decimal (write 1e-3, not 10^-3)")
    unit: str = Field(description="Unit exactly as written in the text, e.g. 'mS/cm', 'S cm-1', 'mAh g-1'")
    conditions: str = Field(default="", description="Measurement conditions if stated, e.g. '25 °C', '60 °C, 0.1 C'; else empty")
    source_type: Literal["measured", "dft", "literature_asserted"] = Field(
        default="literature_asserted",
        description="'measured' if the text says it was measured experimentally, 'dft' if computed, else 'literature_asserted'",
    )
    quote: str = Field(description="Verbatim sentence fragment from the text that contains the value")
    confidence: float = Field(ge=0, le=1, description="Your confidence that the extraction is correct")


class LLMUsedIn(BaseModel):
    formula: str
    application: str = Field(description="Application role as stated in the text, e.g. 'solid electrolyte', 'cathode', 'electrolyte additive'")
    quote: str = Field(description="Verbatim supporting fragment")
    confidence: float = Field(ge=0, le=1)


class LLMGap(BaseModel):
    description: str = Field(description="One sentence stating the open problem / unmet need as the authors frame it")
    application: str | None = Field(default=None, description="Application the gap concerns, if stated")
    quote: str = Field(description="Verbatim supporting fragment")
    confidence: float = Field(ge=0, le=1)


class ExtractionOutput(BaseModel):
    materials: list[LLMMaterial] = Field(default_factory=list)
    property_values: list[LLMPropertyValue] = Field(default_factory=list)
    used_in: list[LLMUsedIn] = Field(default_factory=list)
    gaps: list[LLMGap] = Field(default_factory=list)
