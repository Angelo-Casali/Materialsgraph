"""Claude API wrapper -- validation passes / complex reasoning only.

Used by exactly one code path: `mg harvest validate --cloud`, which asks Claude
whether each extracted candidate is actually supported by its source text.
Never used for bulk extraction or to answer GraphRAG questions (CLAUDE.md:
keep usage minimal).
"""

from __future__ import annotations

import json
import os
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field

DEFAULT_MODEL = "claude-haiku-4-5-20251001"
BATCH_SIZE = 20


class Verdict(BaseModel):
    candidate_id: str
    verdict: Literal["supported", "unsupported", "uncertain"]
    note: str | None = Field(default=None, description="One short sentence explaining the verdict")


class VerdictBatch(BaseModel):
    verdicts: list[Verdict]


SYSTEM = (
    "You are checking whether structured claims extracted from scientific abstracts are actually supported "
    "by the text. For each candidate, answer 'supported' only if the source text clearly states the claim "
    "(same material, same property, same value and unit, same application or gap). Answer 'unsupported' if the "
    "text contradicts it or does not contain it. Answer 'uncertain' otherwise. Be strict about units and exponents. "
    "Return JSON only."
)


def _settings() -> tuple[str | None, str]:
    load_dotenv()
    return os.environ.get("ANTHROPIC_API_KEY"), os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)


def _render(candidate: dict, text: str) -> str:
    fields = {k: v for k, v in candidate.items() if k in ("kind", "formula_raw", "property_type", "value", "unit_raw", "conditions", "application_raw", "description", "quote")}
    return f"CANDIDATE {candidate['candidate_id']}: {json.dumps(fields, ensure_ascii=False)}\nSOURCE TEXT: {text[:4000]}\n"


def validate_candidates(candidates: list[dict], texts: dict[str, str], *, client=None, model: str | None = None) -> list[Verdict]:
    """candidates: serialized Candidate dicts; texts: source_id -> abstract/chunk text."""
    api_key, env_model = _settings()
    if client is None:
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        from anthropic import Anthropic  # lazy

        client = Anthropic(api_key=api_key)
    model = model or env_model
    out: list[Verdict] = []
    for i in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[i : i + BATCH_SIZE]
        prompt = "\n".join(_render(c, texts.get(c["source_id"], "")) for c in batch)
        prompt += (
            "\n\nReturn a JSON object {\"verdicts\": [{\"candidate_id\": ..., \"verdict\": ..., \"note\": ...}, ...]} "
            "with exactly one entry per candidate above."
        )
        msg = client.messages.create(
            model=model,
            max_tokens=2048,
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(block, "text", "") for block in msg.content)
        start, end = text.find("{"), text.rfind("}")
        parsed = VerdictBatch.model_validate_json(text[start : end + 1])
        out.extend(parsed.verdicts)
    return out
