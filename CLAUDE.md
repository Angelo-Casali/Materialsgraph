# MaterialsGraph

## What this is

Personal knowledge graph over battery-materials data. Full context in docs/ —
read docs/technical_buildplan.md first for schema/stack decisions before
touching graph or ingestion code.

## Stack

- Python 3.11+, Neo4j (Community via Docker locally; AuraDB Free for any deployed demo)
- LM Studio (local LLM, OpenAI-compatible endpoint at localhost:1234) for
  literature/enrichment extraction — bulk task, keep it local
- Claude API only for validation passes / complex interpretation — keep usage minimal
- pymatgen / mp-api for Materials Project data
- LangGraph for the NL-to-Cypher query agent

## Commands

- `docker compose up -d` — start local Neo4j (5.26 Community; vector indexes need >= 5.15)
- `mg schema apply` — constraints/indexes + reference data; `mg --help` lists every stage
- `pytest -q` — unit tests (integration tests skip without Neo4j)
- `ruff check src tests` — lint

## Hard rules

- Never write to the graph outside the constraints in src/materialsgraph/graph/schema.cypher;
  all MERGEs live in src/materialsgraph/graph/writers.py
- AI-suggested relationships (USED_IN, SIMILAR_TO from enrichment) are written with
  confirmed=false and must stay that way until a human reviews them
- No proprietary NEOS/Marazzi-derived data, ever
- Don't add a new top-level node label without checking docs/technical_buildplan.md's
  schema section first — extend PropertyType/Domain/Application reference data
  (src/materialsgraph/graph/reference.py) instead
- Data acquisition = licensed APIs + open-access text with provenance (docs/technical_buildplan.md §3).
  No general web crawling, no paywalled full text, only CC-licensed PDFs get chunked

## Scope right now

Stage 1 only (docs/strategy.md): data pipeline -> schema -> graph -> enrichment ->
NL query layer. Nothing past that is in scope for this repo yet.
