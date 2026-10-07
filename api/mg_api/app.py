"""FastAPI app factory. Every dependency is injectable so tests run without Neo4j or an LLM."""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from materialsgraph.graph import queries
from materialsgraph.graph.reference import APPLICATIONS, PROPERTY_TYPES
from materialsgraph.llm.local_client import LLMUnavailable
from materialsgraph.query import tools
from materialsgraph.query.schemas import Citation, GapParams
from mg_api import __version__
from mg_api.models import (
    AskRequest,
    AskResponse,
    BoundedLiterature,
    BoundedScreening,
    CompositionRequest,
    FeasibilityRequest,
    HealthResponse,
    ToolResponse,
)
from mg_api.ratelimit import RateLimiter, client_ip, hashed
from mg_api.settings import ApiSettings

log = logging.getLogger("mg_api")
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
LLM_CALLS_PER_ASK = 2  # router + synthesis


# ---------------------------------------------------------------------------
# default dependencies (real Neo4j / LLM / embedder)
# ---------------------------------------------------------------------------

_driver = None


def _default_session_factory() -> Callable[[], Any]:
    @contextmanager
    def factory() -> Iterator:
        global _driver
        import neo4j

        from materialsgraph.graph.connection import get_driver

        if _driver is None:
            _driver = get_driver()  # module singleton: reused across warm invocations
        with _driver.session(default_access_mode=neo4j.READ_ACCESS) as s:
            yield s

    return factory


def _default_llm():
    from materialsgraph.llm.local_client import query_llm_from_env

    return query_llm_from_env()


def _default_embedder():
    from materialsgraph.enrichment.embeddings import make_embedder

    try:
        return make_embedder()
    except Exception as exc:  # optional dependency missing -> fulltext only
        log.warning("embeddings disabled: %s", exc)
        return None


# ---------------------------------------------------------------------------
def create_app(
    settings: ApiSettings | None = None,
    *,
    session_factory: Callable[[], Any] | None = None,
    llm: Any = "default",
    embedder: Any = "default",
    limiter: RateLimiter | None = None,
) -> FastAPI:
    settings = settings or ApiSettings.from_env()
    session_factory = session_factory or _default_session_factory()
    llm = _default_llm() if llm == "default" else llm
    embedder = _default_embedder() if embedder == "default" else embedder
    limiter = limiter or RateLimiter()

    app = FastAPI(
        title="MaterialsGraph API",
        version=__version__,
        description="Read-only GraphRAG API over the MaterialsGraph battery-materials knowledge graph. Free-tier demo.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.limiter = limiter
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
        max_age=600,
    )

    @app.middleware("http")
    async def body_cap(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_body_bytes:
            return JSONResponse({"detail": "request body too large"}, status_code=413)
        return await call_next(request)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled error on %s", request.url.path)
        return JSONResponse({"detail": "internal error"}, status_code=500)

    # -- rate limit dependencies --------------------------------------------
    def _ip(request: Request) -> str:
        peer = request.client.host if request.client else None
        return client_ip(request.headers, peer, settings.trust_proxy)

    def _too_many(retry: float, msg: str):
        raise HTTPException(status_code=429, detail=msg, headers={"Retry-After": str(max(1, int(retry + 0.999)))})

    def limit_tools(request: Request) -> str:
        ip = _ip(request)
        wait = limiter.check(f"tools:{ip}", per_min=settings.tools_per_min, burst=settings.tools_burst)
        if wait:
            _too_many(wait, "too many requests; slow down a little")
        return ip

    def limit_ask(request: Request) -> str:
        ip = _ip(request)
        wait = limiter.check(f"ask:{ip}", per_min=settings.ask_per_min, burst=settings.ask_burst)
        if wait:
            _too_many(wait, "too many questions per minute")
        wait = limiter.check("ask:global", per_min=settings.global_ask_per_min, burst=settings.global_ask_per_min)
        if wait:
            _too_many(wait, "the atlas is busy; try again shortly")
        if not limiter.daily(f"ask-day:{ip}", limit=settings.ask_per_day):
            _too_many(limiter.seconds_to_midnight(), "daily question limit reached for this address")
        return ip

    # -- helpers ------------------------------------------------------------
    def tool_response(use_case: str, tr, s, started: float) -> ToolResponse:
        cites = [Citation(**c) for c in queries.citations_for(s, tr.source_ids[:50])]
        return ToolResponse(
            use_case=use_case,
            rows=jsonable_encoder(tr.rows),
            notes=tr.notes,
            source_ids=tr.source_ids,
            extra=jsonable_encoder(tr.extra),
            cypher=tr.cypher,
            citations=cites,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
        )

    def run_tool(use_case: str, fn: Callable[[Any], Any]) -> ToolResponse:
        started = time.perf_counter()
        try:
            with session_factory() as s:
                tr = fn(s)
                return tool_response(use_case, tr, s, started)
        except HTTPException:
            raise
        except Exception as exc:
            if _is_db_unavailable(exc):
                raise HTTPException(status_code=503, detail="graph database is asleep or unreachable") from exc
            raise

    # -- routes -------------------------------------------------------------
    @app.get("/api/health", response_model=HealthResponse)
    def health(deep: int = Query(0)):
        db = "skipped"
        sample = None
        if deep:
            try:
                with session_factory() as s:
                    row = s.run("MATCH (m:Material) RETURN count(m) AS n, sum(CASE WHEN m.material_key STARTS WITH 'sample:' THEN 1 ELSE 0 END) AS sample").single()
                    db = "ok"
                    sample = bool(row and row["n"] and row["sample"] == row["n"])
            except Exception as exc:
                db = "sealed" if "paused" in str(exc).lower() else "unreachable"
        return HealthResponse(
            status="ok", version=__version__, public_mode=settings.public_mode, db=db,
            llm="configured" if llm is not None else "none", embeddings="on" if embedder is not None else "off", sample=sample,
        )

    @app.get("/api/meta")
    def meta():
        return {
            "applications": [{"name": n, "aliases": s.get("aliases", []), "kinds": s.get("kinds", []), "requires": s.get("requires", [])} for n, s in APPLICATIONS.items()],
            "property_types": [{"name": p["name"], "unit": p["unit"], "description": p["description"]} for p in PROPERTY_TYPES],
            "use_cases": ["screening", "feasibility", "composition", "literature", "gaps"] + (["freeform"] if settings.allow_freeform else []),
            "limits": {"max_question_chars": settings.max_question_chars, "ask_per_min": settings.ask_per_min, "ask_per_day": settings.ask_per_day},
            "llm": llm is not None,
        }

    @app.get("/api/materials")
    def materials(_: str = Depends(limit_tools)):
        def fn(s):
            rows = s.run(
                "MATCH (m:Material) RETURN m.material_key AS key, m.formula AS formula, m.common_name AS common_name, m.kind AS kind ORDER BY key LIMIT 5000"
            ).data()
            return rows

        try:
            with session_factory() as s:
                return {"materials": fn(s)}
        except Exception as exc:
            if _is_db_unavailable(exc):
                raise HTTPException(status_code=503, detail="graph database is asleep or unreachable") from exc
            raise

    @app.post("/api/tools/screening", response_model=ToolResponse)
    def t_screening(p: BoundedScreening, _: str = Depends(limit_tools)):
        return run_tool("screening", lambda s: tools.screen_materials(s, p))

    @app.post("/api/tools/feasibility", response_model=ToolResponse)
    def t_feasibility(p: FeasibilityRequest, _: str = Depends(limit_tools)):
        return run_tool("feasibility", lambda s: tools.feasibility(s, p, material_key=p.material_key))

    @app.post("/api/tools/composition", response_model=ToolResponse)
    def t_composition(p: CompositionRequest, _: str = Depends(limit_tools)):
        return run_tool("composition", lambda s: tools.composition_analysis(s, p, material_key=p.material_key))

    @app.post("/api/tools/gaps", response_model=ToolResponse)
    def t_gaps(p: GapParams, _: str = Depends(limit_tools)):
        return run_tool("gaps", lambda s: tools.gap_report(s, p))

    @app.post("/api/tools/literature", response_model=ToolResponse)
    def t_literature(p: BoundedLiterature, _: str = Depends(limit_tools)):
        return run_tool("literature", lambda s: tools.retrieve_sources(s, p, embedder))

    @app.post("/api/ask", response_model=AskResponse)
    def ask(req: AskRequest, request: Request, ip: str = Depends(limit_ask)):
        question = CONTROL_CHARS.sub("", req.question).strip()
        if len(question) > settings.max_question_chars:
            raise HTTPException(status_code=422, detail=f"question longer than {settings.max_question_chars} characters")
        if req.use_case == "freeform" and not settings.allow_freeform:
            raise HTTPException(status_code=422, detail="freeform Cypher is disabled on the public demo")
        if req.use_case and req.use_case not in ("screening", "feasibility", "composition", "literature", "gaps", "freeform"):
            raise HTTPException(status_code=422, detail="unknown use case")
        if settings.turnstile_secret and not _turnstile_ok(settings.turnstile_secret, req.turnstile_token, ip):
            raise HTTPException(status_code=403, detail="bot check failed")
        if llm is None:
            return AskResponse(degraded=True, message="No language model is configured on this deployment. Use the guided question builder; it answers without an LLM.")
        if not limiter.daily("llm-budget", limit=settings.daily_llm_budget, cost=LLM_CALLS_PER_ASK):
            return AskResponse(degraded=True, message="Today's free language-model budget is used up. The guided question builder still works.")

        from materialsgraph.query.graphrag import GraphRAGAgent

        log.info("ask from %s (%d chars)", hashed(ip), len(question))
        try:
            with session_factory() as s:
                agent = GraphRAGAgent(s, llm, embedder, max_context_chars=settings.max_context_chars, allow_freeform=settings.allow_freeform)
                answer = agent.answer(question, use_case=req.use_case)
        except LLMUnavailable:
            return AskResponse(degraded=True, message="The free language-model providers are rate-limited right now. The guided question builder still works.")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception as exc:
            if _is_db_unavailable(exc):
                raise HTTPException(status_code=503, detail="graph database is asleep or unreachable") from exc
            raise
        return AskResponse(answer=answer, llm_provider=getattr(llm, "last_provider", None))

    return app


def _is_db_unavailable(exc: Exception) -> bool:
    name = type(exc).__name__
    return name in ("ServiceUnavailable", "SessionExpired", "AuthError") or "paused" in str(exc).lower()


def _turnstile_ok(secret: str, token: str | None, ip: str) -> bool:
    if not token:
        return False
    data = urllib.parse.urlencode({"secret": secret, "response": token, "remoteip": ip}).encode()
    try:
        with urllib.request.urlopen("https://challenges.cloudflare.com/turnstile/v0/siteverify", data=data, timeout=5) as resp:
            return bool(json.loads(resp.read()).get("success"))
    except Exception:
        return False


