"""LM Studio wrapper (OpenAI-compatible, localhost:1234).

All bulk extraction and the GraphRAG router/synthesis go through this
client. `StructuredLLM.complete` returns a validated pydantic object or raises
StructuredOutputError; it never returns half-parsed JSON.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, TypeVar

from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)

DEFAULT_BASE_URL = "http://localhost:1234/v1"
DEFAULT_MODEL = "local-model"


class StructuredOutputError(RuntimeError):
    pass


def settings() -> tuple[str, str]:
    load_dotenv()
    return (
        os.environ.get("LM_STUDIO_BASE_URL", DEFAULT_BASE_URL),
        os.environ.get("LM_STUDIO_MODEL", DEFAULT_MODEL),
    )


def get_client():
    from openai import OpenAI  # lazy

    base_url, _ = settings()
    return OpenAI(base_url=base_url, api_key=os.environ.get("LM_STUDIO_API_KEY", "lm-studio"))


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
    ) -> None:
        _, env_model = settings()
        self.model = model or env_model
        self._client = client
        self._raw_complete = raw_complete
        self.temperature = temperature
        self.max_retries = max_retries
        self._json_schema_supported = True

    @property
    def client(self):
        if self._client is None:
            self._client = get_client()
        return self._client

    def _call(self, messages: list[dict], response_format: dict | None, temperature: float) -> str:
        if self._raw_complete is not None:
            return self._raw_complete(messages, response_format, temperature)
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": temperature}
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
