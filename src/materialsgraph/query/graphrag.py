"""LangGraph GraphRAG agent: route -> resolve -> use-case tool -> retrieve -> synthesize.

Every numeric claim in the answer must carry a [source_id] citation; citations
that are not in the retrieved set are stripped and flagged. The feasibility
verdict is computed deterministically in tools.py; the LLM only narrates it.
"""

from __future__ import annotations

import json
import re
from typing import TypedDict

from materialsgraph.graph.reference import APPLICATIONS, PROPERTY_UNITS
from materialsgraph.query import tools
from materialsgraph.query.schemas import Answer, Citation, LiteratureParams, RouteDecision
from materialsgraph.query.tools import ToolResult


class GraphRAGState(TypedDict, total=False):
    question: str
    route: RouteDecision
    tool_result: ToolResult
    retrieval: ToolResult
    answer: Answer
    errors: list[str]


ROUTER_SYSTEM = f"""You route questions about battery materials to one of these use cases and extract typed parameters.
- screening: find/rank candidate materials by property constraints, elements to include/exclude, stability, application. Property names: {", ".join(sorted(PROPERTY_UNITS))}. Use element symbols (Co, Ni, Li).
- feasibility: assess whether ONE named material suits ONE application (is X feasible/suitable/good as Y?).
- composition: element breakdown, critical-element exposure, similar materials or substitutions for ONE named material; also molecule identity questions.
- literature: what papers/literature say about a topic; recent advances; who reports what.
- gaps: what data is missing, coverage, open problems/challenges for an application or the domain.
- freeform: anything else that needs a custom graph query.
Known applications: {"; ".join(APPLICATIONS)}.
Fill ONLY the parameter object for the chosen use case."""

SYNTH_SYSTEM = """You write concise, factual answers about battery materials from structured graph data.
Rules:
- Use ONLY the facts in the provided data. Do not add outside knowledge.
- Every numeric value you state must be followed by its citation in square brackets, e.g. 1.2e-3 S/cm [doi:10.1000/x].
- Say explicitly when a value is DFT-computed, measured, or literature-asserted, and whether it is confirmed (human-reviewed) or unconfirmed.
- If the data is thin or missing, say so plainly instead of speculating.
- End with a short 'Confidence' section listing, for each cited value, its source type and confirmed status.
Keep it under 300 words."""


def _summarize_for_llm(route: RouteDecision, tr: ToolResult, retrieval: ToolResult | None) -> str:
    payload = {
        "use_case": route.use_case,
        "params": route.params().model_dump() if route.params() else None,
        "rows": tr.rows[:25],
        "extra": tr.extra,
        "notes": tr.notes,
    }
    if retrieval is not None:
        payload["retrieved_sources"] = [
            {k: v for k, v in r.items() if k in ("source_id", "title", "year", "values", "tags", "gaps")} for r in retrieval.rows[:10]
        ]
        if retrieval.extra.get("chunks"):
            payload["retrieved_passages"] = [{"source_id": c["sid"], "text": c["text"][:600]} for c in retrieval.extra["chunks"][:5]]
    return json.dumps(payload, default=str)[:24000]


class GraphRAGAgent:
    def __init__(self, session, llm, embedder=None):
        self.session = session
        self.llm = llm
        self.embedder = embedder
        self.graph = self._build()

    # --- nodes ------------------------------------------------------------
    def route(self, state: GraphRAGState) -> GraphRAGState:
        decision = self.llm.complete(RouteDecision, ROUTER_SYSTEM, state["question"])
        if decision.params() is None:
            # LLM picked a use case but forgot its params; fall back to literature
            decision = RouteDecision(use_case="literature", rationale="router returned no parameters", literature=LiteratureParams(query=state["question"]))
        return {"route": decision}

    def run_tool(self, state: GraphRAGState) -> GraphRAGState:
        route = state["route"]
        p = route.params()
        try:
            if route.use_case == "screening":
                tr = tools.screen_materials(self.session, p)
            elif route.use_case == "feasibility":
                tr = tools.feasibility(self.session, p)
            elif route.use_case == "composition":
                tr = tools.composition_analysis(self.session, p)
            elif route.use_case == "gaps":
                tr = tools.gap_report(self.session, p)
            elif route.use_case == "literature":
                tr = tools.retrieve_sources(self.session, p, self.embedder)
            else:
                from materialsgraph.query.nl_to_cypher import freeform_query

                tr = freeform_query(self.session, self.llm, p.question)
        except Exception as exc:
            tr = ToolResult(notes=[f"tool error: {exc}"])
        return {"tool_result": tr}

    def retrieve(self, state: GraphRAGState) -> GraphRAGState:
        route = state["route"]
        if route.use_case in ("literature", "freeform"):
            return {}
        p = route.params()
        query = {
            "screening": lambda: f"{p.application or ''} {' '.join(p.include_elements)} {' '.join(c.property_type for c in p.constraints)}".strip() or state["question"],
            "feasibility": lambda: f"{p.material} {p.application}",
            "composition": lambda: p.material,
            "gaps": lambda: f"{p.application or 'battery'} open challenges",
        }[route.use_case]()
        try:
            retrieval = tools.retrieve_sources(self.session, LiteratureParams(query=query, k=5), self.embedder)
        except Exception as exc:
            retrieval = ToolResult(notes=[f"retrieval error: {exc}"])
        return {"retrieval": retrieval}

    def synthesize(self, state: GraphRAGState) -> GraphRAGState:
        route = state["route"]
        tr = state["tool_result"]
        retrieval = state.get("retrieval")
        allowed = set(tr.source_ids) | (set(retrieval.source_ids) if retrieval else set())
        data = _summarize_for_llm(route, tr, retrieval)
        if not tr.rows and not (retrieval and retrieval.rows):
            text = "The graph holds no data for this question." + (" Notes: " + "; ".join(tr.notes) if tr.notes else "")
            notes = list(tr.notes)
        else:
            text = self.llm.text(SYNTH_SYSTEM, f"Question: {state['question']}\n\nData (JSON):\n{data}")
            text, stripped = _enforce_citations(text, allowed)
            notes = list(tr.notes)
            if stripped:
                notes.append(f"removed {len(stripped)} citation(s) not present in retrieved data: {sorted(stripped)[:5]}")
        citations = _citations(self.session, sorted(allowed))
        answer = Answer(
            question=state["question"], use_case=route.use_case, text=text, citations=citations,
            confidence_notes=notes, cypher_used=tr.cypher + (retrieval.cypher if retrieval else []), rows=tr.rows[:50],
        )
        return {"answer": answer}

    # --- graph ------------------------------------------------------------
    def _build(self):
        from langgraph.graph import END, StateGraph

        g = StateGraph(GraphRAGState)
        g.add_node("route", self.route)
        g.add_node("run_tool", self.run_tool)
        g.add_node("retrieve", self.retrieve)
        g.add_node("synthesize", self.synthesize)
        g.set_entry_point("route")
        g.add_edge("route", "run_tool")
        g.add_edge("run_tool", "retrieve")
        g.add_edge("retrieve", "synthesize")
        g.add_edge("synthesize", END)
        return g.compile()

    def answer(self, question: str, *, use_case: str | None = None) -> Answer:
        state: GraphRAGState = {"question": question}
        if use_case:
            state["route"] = self._forced_route(question, use_case)
            # skip the router node: run the remaining nodes directly
            state.update(self.run_tool(state))
            state.update(self.retrieve(state))
            state.update(self.synthesize(state))
            return state["answer"]
        final = self.graph.invoke(state)
        return final["answer"]

    def _forced_route(self, question: str, use_case: str) -> RouteDecision:
        decision = self.llm.complete(RouteDecision, ROUTER_SYSTEM + f"\nThe use case is fixed to '{use_case}'; only extract its parameters.", question)
        decision.use_case = use_case  # type: ignore[assignment]
        if decision.params() is None:
            if use_case == "literature":
                decision.literature = LiteratureParams(query=question)
            elif use_case == "freeform":
                from materialsgraph.query.schemas import FreeformParams

                decision.freeform = FreeformParams(question=question)
            else:
                raise ValueError(f"could not extract parameters for use case {use_case!r}")
        return decision


_CITE_RE = re.compile(r"\[([^\[\]]+?)\]")


def _enforce_citations(text: str, allowed: set[str]) -> tuple[str, set[str]]:
    stripped: set[str] = set()

    def repl(m: re.Match) -> str:
        inner = m.group(1).strip()
        ids = [s.strip() for s in inner.split(",")]
        keep = [s for s in ids if s in allowed]
        for s in ids:
            if s not in allowed and (":" in s):
                stripped.add(s)
        return f"[{', '.join(keep)}]" if keep else ("" if any(":" in s for s in ids) else m.group(0))

    return _CITE_RE.sub(repl, text), stripped


def _citations(session, source_ids: list[str]) -> list[Citation]:
    if not source_ids:
        return []
    rows = session.run(
        "UNWIND $ids AS id MATCH (s:Source {source_id: id}) RETURN s.source_id AS source_id, s.title AS title, s.year AS year, s.doi AS doi",
        ids=source_ids,
    )
    return [Citation(**dict(r)) for r in rows]
