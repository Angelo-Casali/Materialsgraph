from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


DEFAULT_ORIGINS = "https://angelo-casali.github.io,http://localhost:5173,http://localhost:4173"


@dataclass
class ApiSettings:
    public_mode: bool = True
    cors_origins: list[str] = field(default_factory=lambda: DEFAULT_ORIGINS.split(","))
    allow_freeform: bool = False
    max_question_chars: int = 300
    max_context_chars: int = 8000
    max_body_bytes: int = 8192
    tools_per_min: int = 30
    tools_burst: int = 10
    ask_per_min: int = 6
    ask_burst: int = 3
    ask_per_day: int = 40
    global_ask_per_min: int = 20
    daily_llm_budget: int = 800  # LLM calls per UTC day, keep below the free provider quota
    trust_proxy: bool = True
    turnstile_secret: str | None = None
    query_timeout_s: float = 10.0

    @classmethod
    def from_env(cls) -> "ApiSettings":
        public = _bool("PUBLIC_MODE", True)
        return cls(
            public_mode=public,
            cors_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()],
            allow_freeform=_bool("ALLOW_FREEFORM", not public),
            max_question_chars=_int("MAX_QUESTION_CHARS", 300),
            max_context_chars=_int("MAX_CONTEXT_CHARS", 8000 if public else 24000),
            tools_per_min=_int("RATE_TOOLS_PER_MIN", 30),
            ask_per_min=_int("RATE_ASK_PER_MIN", 6),
            ask_per_day=_int("RATE_ASK_PER_DAY", 40),
            global_ask_per_min=_int("GLOBAL_ASK_PER_MIN", 20),
            daily_llm_budget=_int("DAILY_LLM_BUDGET", 800),
            trust_proxy=_bool("TRUST_PROXY", True),
            turnstile_secret=os.environ.get("TURNSTILE_SECRET") or None,
        )
