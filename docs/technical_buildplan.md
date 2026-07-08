# MaterialsGraph — Technical Build Plan (MVP: Battery Materials)

*Third document in the set. `strategy.md` = committed timeline/scope. `full_vision.md` = the north-star architecture. This one = the concrete engineering spec to actually start Stage 1 — feed this to Claude Code.*

MVP domain: **battery materials** (chosen over optoelectronic/insulation for the first real build).

---

## 1. Hardware & stack decisions

**Hardware:** HP Omen 16, RTX 5080 16GB VRAM, 32GB RAM.

| Workload | Where it runs | Cost |
|---|---|---|
| Deterministic ETL (Materials Project pull, graph loading) | Local Python script, CPU | $0 |
| Literature/book mining (USED_IN tags, Gap extraction) | Local LLM via LM Studio, GPU | $0 |
| Complex interpretation / validation passes | Claude API, used sparingly | small, metered |
| Neo4j (development) | Docker, Community Edition, local | $0 |
| Neo4j (MVP demo, if/when public) | AuraDB Free tier | $0 (verify current node/relationship cap in the Aura console before relying on it — sources disagree on the exact number right now) |
| Live NL-to-Cypher query layer (deployed demo only) | Cheap hosted API (e.g. Claude Haiku-class) or small hosted open model — not your own GPU, which won't be in the cloud | pay-per-use, small |

**Core Python stack:** `mp-api` / `pymatgen` (data), `neo4j` driver, `langgraph` (NL-to-Cypher agent + literature agent), `sentence-transformers` or similar for local embeddings, `requests` for literature/book APIs.

**Local LLM note:** current "best 16GB model" lists online are inconsistent and change every few weeks — don't trust any single ranking, including this document's. Practical test: load 2–3 candidates in the 8B–14B range in LM Studio (something from the Qwen or Llama family is a reasonable first try) and run your actual extraction prompt against a real literature chunk on each. Keep whichever gets the JSON schema right most consistently. LM Studio serves an OpenAI-compatible endpoint at `localhost:1234` — your LangGraph code calls it exactly like any hosted API, just a different `base_url`.

---

## 2. Neo4j schema (domain-agnostic core, battery-instantiated)

### Design principle
Properties are **nodes**, not fields on `Material` — this is what makes provenance/confidence tracking and gap analysis possible later:

```
(Material)-[:HAS_PROPERTY]->(PropertyValue)-[:OF_TYPE]->(PropertyType)
(PropertyValue)-[:SOURCED_FROM]->(Source)
```

### Node labels

| Label | Key properties |
|---|---|
| `Material` | `mp_id` (unique), `formula`, `structure_type`, `created_at` |
| `Element` | `symbol` (unique), `name`, `atomic_number` |
| `Domain` | `name` (unique) — e.g. `"Battery"` |
| `Application` | `name` (unique) — e.g. `"Li-ion cathode"`, `"solid electrolyte"` |
| `PropertyType` | `name` (unique), `unit`, `description` — e.g. `"ionic_conductivity"` (S/cm) |
| `PropertyValue` | `value`, `unit`, `source_type` (`measured`\|`dft`\|`mlip_predicted`\|`literature_asserted`), `confidence`, `computed_at` |
| `Source` | `source_id` (unique), `title`, `type` (`paper`\|`book`\|`video`), `authors`, `year`, `url_or_doi`, `ingested_at` |
| `Gap` | `gap_id` (unique), `description`, `identified_date` |

### Relationships

```
(Material)-[:COMPOSED_OF {stoichiometry}]->(Element)
(Material)-[:HAS_PROPERTY]->(PropertyValue)
(PropertyValue)-[:OF_TYPE]->(PropertyType)
(PropertyValue)-[:SOURCED_FROM]->(Source)
(Material)-[:USED_IN {confirmed: bool}]->(Application)
(Application)-[:TAGGED_BY]->(Source)
(Application)-[:BELONGS_TO]->(Domain)
(Domain)-[:REQUIRES_PROPERTY {target_min, target_max, importance}]->(PropertyType)
(Material)-[:SIMILAR_TO {method, score, confirmed: bool}]->(Material)
(Domain)-[:HAS_GAP]->(Gap)
(Gap)-[:DOCUMENTED_IN]->(Source)
```

### Constraints & indexes (Cypher, run once against the database)

```cypher
CREATE CONSTRAINT material_mp_id IF NOT EXISTS FOR (m:Material) REQUIRE m.mp_id IS UNIQUE;
CREATE CONSTRAINT element_symbol IF NOT EXISTS FOR (e:Element) REQUIRE e.symbol IS UNIQUE;
CREATE CONSTRAINT domain_name IF NOT EXISTS FOR (d:Domain) REQUIRE d.name IS UNIQUE;
CREATE CONSTRAINT application_name IF NOT EXISTS FOR (a:Application) REQUIRE a.name IS UNIQUE;
CREATE CONSTRAINT proptype_name IF NOT EXISTS FOR (p:PropertyType) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.source_id IS UNIQUE;
CREATE CONSTRAINT gap_id IF NOT EXISTS FOR (g:Gap) REQUIRE g.gap_id IS UNIQUE;

CREATE INDEX propvalue_type IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.property_type);
CREATE INDEX propvalue_source_type IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.source_type);
CREATE INDEX source_type_idx IF NOT EXISTS FOR (s:Source) ON (s.type);
CREATE INDEX source_year IF NOT EXISTS FOR (s:Source) ON (s.year);
```

### Battery-domain seed data (what Phase 1–2 actually populates first)

**Domain:** `Battery`
**PropertyTypes to seed:** `ionic_conductivity` (S/cm), `voltage` (V), `specific_capacity` (mAh/g), `formation_energy` (eV/atom), `band_gap` (eV), `cycling_stability` (% capacity retention @ N cycles)
**Applications to seed:** `"Li-ion cathode"`, `"Na-ion cathode"`, `"solid electrolyte"`, `"anode material"`
**Domain requirements (illustrative):**
```cypher
MATCH (d:Domain {name: "Battery"}), (p:PropertyType {name: "ionic_conductivity"})
MERGE (d)-[:REQUIRES_PROPERTY {target_min: 1e-4, target_max: null, importance: "high"}]->(p);
```

### Example query this schema enables (the actual payoff)

```cypher
// Battery cathode candidates with DFT-or-better confidence, flag missing conductivity data
MATCH (m:Material)-[:USED_IN {confirmed: true}]->(:Application {name: "Li-ion cathode"})
OPTIONAL MATCH (m)-[:HAS_PROPERTY]->(pv:PropertyValue)-[:OF_TYPE]->(:PropertyType {name: "ionic_conductivity"})
RETURN m.formula, m.mp_id,
       CASE WHEN pv IS NULL THEN "MISSING" ELSE pv.value END AS ionic_conductivity,
       CASE WHEN pv IS NULL THEN "gap" ELSE pv.source_type END AS status
```

This single query is the "identify what's missing" feature from the brief, running directly against the schema — no separate system needed for it.

---

## 3. Literature & book scout (new-books-priority)

A separate, small tool — not part of core ingestion.

**Sources (legitimate metadata only, no full-text piracy):**
- Papers: Semantic Scholar API, arXiv API, CrossRef API
- Books: Google Books API, Open Library API

**Ranking logic:** two buckets, not one blind recency sort —
- **Recent (last ~18 months), prioritized** — matches the "new books first" instruction
- **Foundational, for reference** — so a genuinely excellent older text isn't buried under thin new content

**What it outputs:** title, authors, year, link, and (via the local LLM) a one-line "why this looks relevant" note — for you to review before acquiring anything. No LLM needed for the search/ranking itself, only for the annotation.

### Real starter shortlist for battery materials (pulled just now, to seed the tool's first run)

**Recent / prioritized:**
- *Computational Design of Battery Materials* — Springer, softcover ed. published July 2025. Directly matches the AI-driven angle of this project.
- Strauss et al., "2026 roadmap on next-generation solid electrolytes for battery applications," *Materials Futures*, 2026 (DOI: 10.1088/2752-5724/ae5120) — a roadmap paper; these explicitly discuss open challenges, ideal for seeding `Gap` nodes.
- Zaghib, "Comparative Advances in Sulfide and Halide Electrolytes for Commercialization of All-Solid-State Lithium Batteries," *Advanced Materials*, 2026 (DOI: 10.1002/adma.202513255).
- Armand et al., "Toward a Unified Mechanistic Understanding of Polymer Electrolytes for Advanced Solid-State Batteries," *Advanced Materials*, 2026 (DOI: 10.1002/adma.73750) — Armand is one of the founding figures in battery electrolyte chemistry, so this carries real authority despite being brand new.

**Foundational (older, still worth having):** search your library/university access for standard solid-state ionics and lithium battery materials handbooks predating 2020 — the scout tool should surface these once built; this list is deliberately left short here since a proper run of the tool will do this systematically rather than ad hoc.

---

## 4. Repo structure (hand this to Claude Code as the target layout)

```
materialsgraph/
├── CLAUDE.md
├── docs/
│   ├── strategy.md
│   ├── full_vision.md
│   └── technical_buildplan.md
├── src/materialsgraph/
│   ├── ingestion/
│   │   ├── mp_client.py        # Materials Project pull (no LLM)
│   │   └── schema_loader.py    # loads into Neo4j against schema.cypher
│   ├── enrichment/
│   │   ├── literature_agent.py # RAG enrichment -> USED_IN, Gap nodes (local LLM)
│   │   └── book_scout.py       # literature/book discovery, recency-ranked
│   ├── graph/
│   │   ├── schema.cypher       # constraints/indexes from Section 2
│   │   └── queries.py          # reusable Cypher, incl. the gap-query above
│   ├── query/
│   │   └── nl_to_cypher.py     # LangGraph NL query agent
│   └── llm/
│       ├── local_client.py     # LM Studio wrapper (OpenAI-compatible, localhost:1234)
│       └── cloud_client.py     # Claude API wrapper — validation/complex reasoning only
├── notebooks/
│   └── 01_explore_mp_data.ipynb
├── tests/
├── docker-compose.yml           # Neo4j Community container
├── pyproject.toml
└── .env.example
```

---

## 5. CLAUDE.md (starter template — trim after `/init`)

```markdown
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
```

---

## 6. Deployment (cheapest path, recap)

1. **Build:** fully local, $0 — Neo4j Community in Docker, LM Studio on your own GPU.
2. **MVP demo, if/when wanted:** Neo4j AuraDB Free (verify current cap in-console) + small FastAPI app on a free host tier (Render/Fly.io).
3. **Live query layer in that demo:** cheap hosted API call per query (Claude Haiku-class or similar) — your RTX 5080 won't be present in the cloud, so this is the one place local stops being free once it's public.
