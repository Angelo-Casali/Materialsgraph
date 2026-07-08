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

- `docker compose up -d` — start local Neo4j
- `pytest` — run tests
  (fill in actual lint/format commands as they're added)

## Hard rules

- Never write to the graph outside the constraints in src/materialsgraph/graph/schema.cypher
- AI-suggested relationships (USED_IN, SIMILAR_TO from enrichment) are written with
  confirmed=false and must stay that way until a human reviews them
- No proprietary NEOS/Marazzi-derived data, ever
- Don't add a new top-level node label without checking docs/technical_buildplan.md's
  schema section first — extend PropertyType/Domain/Application reference data instead

## Scope right now

Stage 1 only (docs/strategy.md): data pipeline -> schema -> graph -> enrichment ->
NL query layer. Nothing past that is in scope for this repo yet.
