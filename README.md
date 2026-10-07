# MaterialsGraph

A personal knowledge graph over battery-materials data: Materials Project and OPTIMADE computed properties, measured solid-electrolyte conductivities, electrolyte molecules, and literature-derived application tags, property values and open-problem ("gap") statements — every value with provenance, every AI-derived edge behind a human review gate — queryable in natural language through a GraphRAG agent.

Read `docs/technical_buildplan.md` first (schema, provenance semantics, harvester, query layer). `docs/strategy.md` is the committed scope; `docs/harvester_graphrag_plan.md` is the feasibility assessment and phase plan behind the current code.

## Setup

```bash
cp .env.example .env            # fill NEO4J_PASSWORD, MP_API_KEY, OPENALEX_MAILTO; LM_STUDIO_MODEL
pip install -e ".[dev,fulltext]"
docker compose up -d            # Neo4j 5.26 Community on bolt://localhost:7687
mg schema apply                 # constraints, indexes, reference data, periodic table
```

LM Studio must be serving an OpenAI-compatible endpoint (default `http://localhost:1234/v1`) for extraction and for `mg ask`. The Claude API is used only by `mg harvest validate --cloud`.

## Pipeline

```bash
# Tier 1: structured, deterministic (no LLM)
mg ingest mp --ions Li,Na                 # data/raw/battery_electrodes_<ion>.json
mg ingest optimade --provider oqmd        # data/raw/optimade_oqmd.json
mg ingest liverpool                       # measured Li conductivities (checks the repo licence)
mg ingest molecules                       # electrolyte molecules via PubChem (--offline uses the alias table)
mg load --mp --optimade oqmd --liverpool --molecules

# Tier 2: literature harvester (local LLM) with a human review gate
mg harvest discover --keywords "halide solid electrolyte,argyrodite conductivity" --since 2023 --limit 50
mg harvest fulltext --batch <id>          # CC-licensed open-access PDFs only -> Chunks
mg harvest extract  --batch <id>          # LM Studio -> candidates (materials, values, USED_IN, gaps)
mg harvest validate --batch <id> [--cloud]
mg harvest review   --batch <id>          # a / r / e / s / q  -- nothing AI-derived is confirmed without this
mg harvest commit   --batch <id> [--include-pending]
mg harvest stats
mg embed --chunks                         # 384-d sentence-transformers vectors for retrieval
mg similar                                # composition-cosine SIMILAR_TO, confirmed=false

# GraphRAG
mg ask "stable Li cathodes without Co with capacity above 150 mAh/g"
mg ask "is Li7La3Zr2O12 feasible as a solid electrolyte" --show-cypher
mg ask "critical-element exposure of LiNi0.8Co0.1Mn0.1O2"
mg ask "what does recent literature say about halide electrolytes" --use-case literature
mg ask "what data is missing for solid electrolytes" --use-case gaps
```

`mg harvest run --keywords ... --fulltext` chains discover -> fulltext -> extract -> validate -> stage in one go.

## Use cases the query layer serves

| Use case | Question shape | What comes back |
|---|---|---|
| screening (materials identification) | "find stable X without Co with capacity > 150" | ranked candidates, each value with source type, confirmed flag and source id |
| feasibility study | "is LLZO feasible as a solid electrolyte?" | each requirement target met / unmet / missing / conflicting, deterministic verdict, supporting sources, related gaps |
| composition / molecular analysis | "critical-element exposure of NMC811", "what is LiTFSI" | element fractions with EU/USGS criticality flags, substitutions, similar materials; molecule identity and roles |
| literature | "what does recent work say about halide electrolytes" | hybrid vector + full-text retrieval expanded into the values/tags/gaps those papers support |
| gaps / coverage | "what is missing for solid electrolytes" | coverage per required property plus documented open problems |
| freeform | anything else | LLM-written Cypher, validated read-only, bounded, EXPLAINed |

## Hard rules (see CLAUDE.md)

- All graph writes go through `src/materialsgraph/graph/writers.py`; every MERGE key is a constraint in `schema.cypher`.
- LLM-derived `USED_IN`, `PropertyValue`, `SIMILAR_TO`, `Gap` are written `confirmed=false` until a human accepts them in `mg harvest review`.
- No general web crawling and no paywalled full text; only CC-licensed PDFs are chunked. No NEOS/Marazzi-derived data.

## Tests

```bash
pytest -q                 # unit tests run anywhere; integration tests skip unless Neo4j is reachable
ruff check src tests
```

`tests/eval/questions.jsonl` is the golden routing set: run `mg ask --json` over it against your LM Studio model to measure router accuracy and citation counts.
