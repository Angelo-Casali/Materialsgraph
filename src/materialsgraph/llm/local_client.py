"""LM Studio wrapper (OpenAI-compatible, localhost:1234).

All bulk extraction and the GraphRAG router/synthesis go through this
client. `StructuredLLM.complete` returns a validated pydantic object or raises
StructuredOutputError; it never returns half-parsed JSON.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Callable, Literal, TypeVar

from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)

DEFAULT_BASE_URL = "http://localhost:1234/v1"
DEFAULT_MODEL = "local-model"


class StructuredOutputError(RuntimeError):
    pass


class LLMUnavailable(RuntimeError):
    """Every configured provider failed (quota, outage, missing key)."""


Profile = Literal["extract", "query"]


@dataclass(frozen=True)
class LLMSettings:
    base_url: str
    model: str
    api_key: str
    max_tokens: int | None = None
    timeout_s: float | None = None


def _env_int(name: str) -> int | None:
    v = os.environ.get(name)
    return int(v) if v and v.strip().isdigit() else None


def _env_float(name: str) -> float | None:
    v = os.environ.get(name)
    try:
        return float(v) if v else None
    except ValueError:
        return None


def llm_settings(profile: Profile = "extract", *, prefix: str = "QUERY_LLM") -> LLMSettings:
    """Resolve provider settings.

    profile="extract": LM Studio only. Bulk extraction stays local (CLAUDE.md).
    profile="query":   <prefix>_BASE_URL / _API_KEY / _MODEL / _MAX_TOKENS / _TIMEOUT_S
                       (e.g. a free Groq or OpenRouter model for the deployed demo),
                       each falling back to the LM Studio settings.
    """
    load_dotenv()
    base = os.environ.get("LM_STUDIO_BASE_URL", DEFAULT_BASE_URL)
    model = os.environ.get("LM_STUDIO_MODEL", DEFAULT_MODEL)
    key = os.environ.get("LM_STUDIO_API_KEY", "lm-studio")
    if profile == "extract":
        return LLMSettings(base, model, key)
    return LLMSettings(
        base_url=os.environ.get(f"{prefix}_BASE_URL") or base,
        model=os.environ.get(f"{prefix}_MODEL") or model,
        api_key=os.environ.get(f"{prefix}_API_KEY") or key,
        max_tokens=_env_int(f"{prefix}_MAX_TOKENS"),
        timeout_s=_env_float(f"{prefix}_TIMEOUT_S"),
    )


def settings() -> tuple[str, str]:
    """Backwards-compatible: (base_url, model) of the extraction profile."""
    s = llm_settings("extract")
    return s.base_url, s.model


def get_client(cfg: LLMSettings | None = None):
    from openai import OpenAI  # lazy

    cfg = cfg or llm_settings("extract")
    kwargs: dict[str, Any] = {"base_url": cfg.base_url, "api_key": cfg.api_key}
    if cfg.timeout_s is not None:
        kwargs["timeout"] = cfg.timeout_s
        kwargs["max_retries"] = 0  # fail fast; FallbackLLM moves on to the next provider
    return OpenAI(**kwargs)


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
    # some models prepend prose; grab the outermost JSON object
    if not text.lstrip().startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1:
            text = text[start : end + 1]
    return text.strip()


class StructuredLLM:
    """Pydantic-schema-constrained chat completion with retries.

    `raw_complete` is injectable so tests can run without LM Studio:
    it takes (messages, response_format|None) and returns the assistant text.
    """

    def __init__(
        self,
        model: str | None = None,
        *,
        client=None,
        raw_complete: Callable[[list[dict], dict | None, float], str] | None = None,
        temperature: float = 0.0,
        max_retries: int = 2,
        profile: Profile = "extract",
        cfg: LLMSettings | None = None,
    ) -> None:
        self.cfg = cfg or llm_settings(profile)
        self.model = model or self.cfg.model
        self.provider = self.cfg.base_url
        self._client = client
        self._raw_complete = raw_complete
        self.temperature = temperature
        self.max_retries = max_retries
        self._json_schema_supported = True

    @property
    def client(self):
        if self._client is None:
            self._client = get_client(self.cfg)
        return self._client

    def _call(self, messages: list[dict], response_format: dict | None, temperature: float) -> str:
        if self._raw_complete is not None:
            return self._raw_complete(messages, response_format, temperature)
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": temperature}
        if self.cfg.max_tokens:
            kwargs["max_tokens"] = self.cfg.max_tokens
        if response_format is not None:
            kwargs["response_format"] = response_format
        resp = self.client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content or ""

    def complete(self, schema: type[T], system: str, user: str, *, temperature: float | None = None) -> T:
        temp = self.temperature if temperature is None else temperature
        json_schema = schema.model_json_schema()
        schema_hint = (
            "\n\nRespond with a single JSON object and nothing else. It must validate against this JSON schema:\n"
            + json.dumps(json_schema)
        )
        messages = [
            {"role": "system", "content": system + schema_hint},
            {"role": "user", "content": user},
        ]
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            response_format: dict | None
            if self._json_schema_supported:
                response_format = {
                    "type": "json_schema",
                    "json_schema": {"name": schema.__name__, "schema": json_schema, "strict": False},
                }
            else:
                response_format = {"type": "json_object"}
            try:
                text = self._call(messages, response_format, temp)
            except Exception as exc:  # e.g. HTTP 400 "response_format not supported"
                msg = str(exc).lower()
                if self._json_schema_supported and ("response_format" in msg or "json_schema" in msg):
                    self._json_schema_supported = False
                    continue
                if _is_provider_failure(exc):
                    raise  # quota/outage: let FallbackLLM switch providers instead of retrying here
                if attempt >= self.max_retries:
                    raise StructuredOutputError(f"LLM call failed: {exc}") from exc
                last_error = exc
                continue
            try:
                return schema.model_validate_json(_strip_fences(text))
            except (ValidationError, ValueError) as exc:
                last_error = exc
                messages.append({"role": "assistant", "content": text})
                messages.append(
                    {
                        "role": "user",
                        "content": "That JSON did not validate. Error:\n"
                        + str(exc)[:1500]
                        + "\nReturn only a corrected JSON object.",
                    }
                )
        raise StructuredOutputError(f"no valid {schema.__name__} after {self.max_retries + 1} attempts: {last_error}")

    def text(self, system: str, user: str, *, temperature: float | None = None) -> str:
        temp = self.temperature if temperature is None else temperature
        return self._call(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            None,
            temp,
        )


def _is_provider_failure(exc: Exception) -> bool:
    """Quota/outage/auth errors that mean 'try the next provider', as opposed to bad output."""
    status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    if status in (401, 402, 403, 404, 408, 409, 429) or (isinstance(status, int) and status >= 500):
        return True
    name = type(exc).__name__.lower()
    return any(k in name for k in ("ratelimit", "timeout", "connection", "apistatus", "internalserver", "authentication"))


class FallbackLLM:
    """Same interface as StructuredLLM; tries providers in order on quota/outage errors."""

    def __init__(self, primary: StructuredLLM, *fallbacks: StructuredLLM):
        self.providers = [primary, *fallbacks]
        self.model = primary.model
        self.last_provider: str | None = None

    def _run(self, method: str, *args, **kwargs):
        errors = []
        for llm in self.providers:
            try:
                out = getattr(llm, method)(*args, **kwargs)
                self.last_provider = f"{llm.provider}#{llm.model}"
                self.model = llm.model
                return out
            except StructuredOutputError as exc:
                cause = exc.__cause__
                if cause is not None and _is_provider_failure(cause):
                    errors.append(f"{llm.model}: {cause}")
                    continue
                raise
            except Exception as exc:
                if _is_provider_failure(exc):
                    errors.append(f"{llm.model}: {exc}")
                    continue
                raise
        raise LLMUnavailable("; ".join(errors) or "no LLM provider configured")

    def complete(self, schema, system: str, user: str, *, temperature: float | None = None):
        return self._run("complete", schema, system, user, temperature=temperature)

    def text(self, system: str, user: str, *, temperature: float | None = None) -> str:
        return self._run("text", system, user, temperature=temperature)


def query_llm_from_env() -> FallbackLLM | None:
    """QUERY_LLM_* primary plus optional QUERY_LLM_FALLBACK_* provider. None when no hosted key is set
    and LM Studio is not explicitly allowed (the public API must not silently point at localhost)."""
    load_dotenv()
    providers: list[StructuredLLM] = []
    for prefix in ("QUERY_LLM", "QUERY_LLM_FALLBACK"):
        if os.environ.get(f"{prefix}_BASE_URL") and os.environ.get(f"{prefix}_MODEL"):
            cfg = llm_settings("query", prefix=prefix)
            providers.append(StructuredLLM(cfg=cfg, max_retries=1))
    if not providers and os.environ.get("QUERY_LLM_ALLOW_LOCAL") == "1":
        providers.append(StructuredLLM(profile="query"))
    return FallbackLLM(*providers) if providers else None
