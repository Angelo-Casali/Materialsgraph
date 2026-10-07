"""LangGraph NL query agent entry point and the guarded freeform NL-to-Cypher fallback.

`mg ask "..."` builds a GraphRAGAgent (query/graphrag.py). This module holds
the one tool that lets the LLM write Cypher: the output is validated by
cypher_safety.validate_read_only, EXPLAINed, then run inside a read
transaction with a timeout.
"""

from __future__ import annotations

from materialsgraph.graph.reference import APPLICATIONS, PROPERTY_UNITS
from materialsgraph.query.cypher_safety import UnsafeCypherError, run_read_only, validate_read_only
from materialsgraph.query.tools import ToolResult

SCHEMA_SUMMARY = f"""Node labels and key properties:
(:Material {{material_key, formula, reduced_formula, kind: 'crystal'|'molecule', mp_id, spacegroup, common_name}})
(:Element {{symbol, name, atomic_number, eu_crm_2023, usgs_2022}})
(:PropertyType {{name, unit}})  names: {", ".join(sorted(PROPERTY_UNITS))}
(:PropertyValue {{property_type, value, unit, source_type: 'measured'|'dft'|'literature_asserted', confirmed, conditions, source_id}})
(:Application {{name}})  names: {"; ".join(APPLICATIONS)}
(:Domain {{name: 'Battery'}})
(:Source {{source_id, title, year, doi, type}})
(:Gap {{gap_id, description, status}})
Relationships:
(Material)-[:COMPOSED_OF {{stoichiometry, fraction}}]->(Element)
(Material)-[:HAS_PROPERTY]->(PropertyValue)-[:OF_TYPE]->(PropertyType)
(PropertyValue)-[:SOURCED_FROM]->(Source)
(Material)-[:USED_IN {{confirmed, basis, source_id}}]->(Application)-[:BELONGS_TO]->(Domain)
(Application|Domain)-[:REQUIRES_PROPERTY {{target_min, target_max, importance}}]->(PropertyType)
(Material)-[:SIMILAR_TO {{method, score, confirmed}}]->(Material)
(Domain)-[:HAS_GAP]->(Gap)-[:DOCUMENTED_IN]->(Source)
"""

GEN_SYSTEM = (
    "You translate natural-language questions about a Neo4j battery-materials graph into ONE read-only Cypher query.\n"
    "Rules: MATCH/OPTIONAL MATCH/WITH/UNWIND/RETURN only; never CREATE/MERGE/SET/DELETE; no procedures; "
    "always RETURN m.material_key and m.formula when returning materials; include pv.source_type, pv.confirmed and pv.source_id "
    "whenever you return a PropertyValue; end with LIMIT 50 or less. Return only the Cypher, no prose.\n\n" + SCHEMA_SUMMARY
)


def generate_cypher(llm, question: str) -> str:
    text = llm.text(GEN_SYSTEM, question)
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if text.lower().startswith("cypher") else text
    return text.strip()


def freeform_query(session, llm, question: str, *, attempts: int = 2) -> ToolResult:
    res = ToolResult()
    last_error = None
    for _ in range(attempts):
        cypher = generate_cypher(llm, question if last_error is None else f"{question}\n\nPrevious attempt failed with: {last_error}. Fix it.")
        try:
            safe = validate_read_only(cypher)
            session.run("EXPLAIN " + safe).consume()
            rows = run_read_only(session, safe)
        except UnsafeCypherError as exc:
            last_error = f"unsafe: {exc}"
            res.notes.append(last_error)
            continue
        except Exception as exc:
            last_error = str(exc)
            res.notes.append(f"cypher error: {exc}")
            continue
        res.cypher.append(safe)
        res.rows = rows
        res.source_ids = sorted({str(v) for r in rows for k, v in r.items() if k.endswith("source_id") and v})
        return res
    return res


def main(argv: list[str] | None = None) -> None:
    import argparse

    from materialsgraph.graph.connection import session as open_session
    from materialsgraph.llm.local_client import StructuredLLM
    from materialsgraph.query.graphrag import GraphRAGAgent

    parser = argparse.ArgumentParser(description="Ask the materials graph a question")
    parser.add_argument("question")
    parser.add_argument("--use-case", choices=["screening", "feasibility", "composition", "literature", "gaps", "freeform"])
    parser.add_argument("--show-cypher", action="store_true")
    parser.add_argument("--no-embeddings", action="store_true", help="skip vector retrieval (fulltext only)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    embedder = None
    if not args.no_embeddings:
        from materialsgraph.enrichment.embeddings import make_embedder

        embedder = make_embedder()
    with open_session() as s:
        agent = GraphRAGAgent(s, StructuredLLM(profile="query"), embedder)
        answer = agent.answer(args.question, use_case=args.use_case)
    if args.json:
        print(answer.model_dump_json(indent=2))
        return
    print(f"[{answer.use_case}]\n")
    print(answer.text)
    if answer.citations:
        print("\nSources:")
        for c in answer.citations:
            print(f"  [{c.source_id}] {c.title or ''} ({c.year or 'n/a'})")
    if answer.confidence_notes:
        print("\nNotes:")
        for n in answer.confidence_notes:
            print(f"  - {n}")
    if args.show_cypher:
        print("\nCypher used:")
        for q in answer.cypher_used:
            print("  " + q.replace("\n", "\n  "))


if __name__ == "__main__":
    main()
