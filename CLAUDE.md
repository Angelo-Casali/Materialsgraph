# MaterialsGraph

## What this is

Two parts, one site:
- **Challenge tracker (front page, active):** sourced state of the art on energy-transition challenges,
  each with a technology radar and optional simulator. Pure static content in web/; see docs/challenges.md.
- **Battery-materials graph (frozen, still working at #/atlas):** personal knowledge graph over battery-materials data. Full context in docs/ —
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
- `ruff check src tests api scripts` — lint
- `mg site build-sample` / `mg export site` — regenerate the website snapshot (web/public/data/snapshot.json)
- `cd web && npm test && npm run build && npx playwright test` — website unit tests, build + budget, e2e

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

- The illustrative sample (`sample:` keys, source `sample:illustrative`) must never mix into a real graph:
  `mg import snapshot` refuses without --force; `mg site purge-sample --yes` removes it
- Site exports never include abstracts, chunk text or embeddings (copyright); keep the sample free of
  invented DOIs, database ids or paper-attributed claims
- Keep web/src/lib/engine/* in parity with src/materialsgraph/query/tools.py (shared fixtures in
  tests/fixtures/feasibility_cases.json); the public API stays read-only and free-tier only

## Challenge tracker rules

- Every figure and technology in web/src/data/challenges/*.json cites a source id; unsourced statements carry
  "editorial": true. Enforced by web/src/lib/challenges/challenges.test.ts — keep it green
- Simulator prices are examples, never presented as current tariffs; official factors cite their source

## Scope right now

Challenge tracker: home heating published; ceramic kilns, thermal storage and batteries planned (docs/challenges.md).
Battery graph (below) is frozen: keep it building and tested, no new features unless asked.

Stage 1 (docs/strategy.md): data pipeline -> schema -> graph -> enrichment -> NL query layer,
plus the public showcase: static site (web/) and the free-tier read-only API (api/).
