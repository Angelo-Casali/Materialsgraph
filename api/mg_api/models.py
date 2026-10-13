from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

from materialsgraph.query.schemas import (
    Answer,
    Citation,
    CompositionParams,
    FeasibilityParams,
    GapParams,
    LiteratureParams,
    RouteDecision,
    ScreeningParams,
)


class ToolResponse(BaseModel):
    use_case: str
    rows: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    extra: dict[str, Any] = Field(default_factory=dict)
    cypher: list[str] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    elapsed_ms: int = 0


class BoundedScreening(ScreeningParams):
    @field_validator("limit")
    @classmethod
    def _limit(cls, v: int) -> int:
        return max(1, min(v, 50))

    @field_validator("constraints")
    @classmethod
    def _constraints(cls, v):
        if len(v) > 5:
            raise ValueError("at most 5 property constraints")
        return v

    @field_validator("include_elements", "exclude_elements")
    @classmethod
    def _elements(cls, v):
        if len(v) > 10:
            raise ValueError("at most 10 elements")
        return v


class FeasibilityRequest(FeasibilityParams):
    material_key: str | None = None


class CompositionRequest(CompositionParams):
    material_key: str | None = None


class BoundedLiterature(LiteratureParams):
    @field_validator("k")
    @classmethod
    def _k(cls, v: int) -> int:
        return max(1, min(v, 15))


class AskRequest(BaseModel):
    question: str = Field(min_length=3)
    use_case: str | None = None
    turnstile_token: str | None = None


class AskResponse(BaseModel):
    answer: Answer | None = None
    route: RouteDecision | None = None
    degraded: bool = False
    message: str | None = None
    llm_provider: str | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    public_mode: bool
    db: str
    llm: str
    embeddings: str
    sample: bool | None = None


__all__ = [
    "AskRequest", "AskResponse", "BoundedLiterature", "BoundedScreening", "CompositionRequest", "FeasibilityRequest",
    "GapParams", "HealthResponse", "ToolResponse",
]
