"""Typed parameters for each GraphRAG use case, plus the router's decision schema."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

UseCase = Literal["screening", "feasibility", "composition", "literature", "gaps", "freeform"]


class PropertyConstraint(BaseModel):
    property_type: str = Field(description="One of the known PropertyType names")
    min: float | None = None
    max: float | None = None


class ScreeningParams(BaseModel):
    """Materials identification: find candidates satisfying property/element/stability constraints."""

    application: str | None = Field(default=None, description="Application name or alias if the question names one")
    include_elements: list[str] = Field(default_factory=list, description="Element symbols that must be present")
    exclude_elements: list[str] = Field(default_factory=list, description="Element symbols that must be absent")
    constraints: list[PropertyConstraint] = Field(default_factory=list)
    max_energy_above_hull: float | None = Field(default=0.05, description="Stability cap in eV/atom; null to ignore")
    kind: Literal["crystal", "molecule", "any"] = "crystal"
    order_by: str | None = Field(default=None, description="PropertyType to rank by (desc)")
    limit: int = 15


class FeasibilityParams(BaseModel):
    """Feasibility study: does a material meet an application's requirement targets, on what evidence?"""

    material: str = Field(description="Formula, acronym or name as written in the question")
    application: str = Field(description="Target application name or alias")


class CompositionParams(BaseModel):
    """Compositional / molecular analysis of one material."""

    material: str
    include_similar: bool = True
    include_substitutions: bool = True


class LiteratureParams(BaseModel):
    """Literature-grounded question answered from retrieved sources plus their graph neighbourhood."""

    query: str
    since_year: int | None = None
    k: int = 8


class GapParams(BaseModel):
    application: str | None = None


class FreeformParams(BaseModel):
    question: str


class RouteDecision(BaseModel):
    use_case: UseCase
    rationale: str = Field(description="One sentence on why this use case fits")
    screening: ScreeningParams | None = None
    feasibility: FeasibilityParams | None = None
    composition: CompositionParams | None = None
    literature: LiteratureParams | None = None
    gaps: GapParams | None = None
    freeform: FreeformParams | None = None

    def params(self):
        return getattr(self, self.use_case)


class Citation(BaseModel):
    source_id: str
    title: str | None = None
    year: int | None = None
    doi: str | None = None


class Answer(BaseModel):
    question: str
    use_case: UseCase
    text: str
    citations: list[Citation] = Field(default_factory=list)
    confidence_notes: list[str] = Field(default_factory=list)
    cypher_used: list[str] = Field(default_factory=list)
    rows: list[dict] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
