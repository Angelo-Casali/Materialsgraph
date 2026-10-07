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
| `Material` | `material_key` (unique, namespaced: `mp:<mp_id>` \| `oqmd:<id>` \| `lit:<reduced_formula>[\|<spacegroup>]` \| `mol:<inchikey>`), `mp_id` (unique when present), `formula`, `reduced_formula`, `kind` (`crystal`\|`molecule`), `spacegroup`, `spacegroup_number`, `structure_type`, `smiles`, `inchikey`, `common_name`, `external_ids`, `data_source`, `license`, `provider`, `created_at` |
| `Element` | `symbol` (unique), `name`, `atomic_number`, `eu_crm_2023`, `usgs_2022`, `supply_risk_note` (public critical-raw-material lists) |
| `Domain` | `name` (unique) — e.g. `"Battery"` |
| `Application` | `name` (unique), `description`, `aliases` — e.g. `"Li-ion cathode"`, `"solid electrolyte"`, `"electrolyte salt"` |
| `PropertyType` | `name` (unique), `unit`, `description`, `plausible_min`, `plausible_max` — e.g. `"ionic_conductivity"` (S/cm) |
| `PropertyValue` | `value`, `unit`, `property_type`, `source_id`, `conditions` (JSON string, `""` = unspecified), `source_type` (`measured`\|`dft`\|`mlip_predicted`\|`literature_asserted`), `confidence`, `confirmed` (bool), `extraction_method`, `quote`, `computed_at` |
| `Source` | `source_id` (unique), `title`, `type` (`paper`\|`preprint`\|`book`\|`video`\|`database`), `authors`, `year`, `url_or_doi`, `doi`, `abstract`, `abstract_embedding` (384 floats), `license`, `openalex_id`, `is_oa`, `oa_pdf_url`, `provider`, `ingested_at` |
| `Chunk` | `chunk_id` (unique), `text`, `embedding` (384 floats), `section`, `page`, `ordinal`, `source_id` — full-text passages of **CC-licensed open-access** sources only |
| `Gap` | `gap_id` (unique), `description`, `status` (`open`\|`addressed`), `application`, `extraction_method`, `confirmed`, `identified_date` |

`Chunk` is the one label added since the first draft. It exists because open-access full text is in scope (see §3): a paper's passages need their own vector index and their own provenance link, and overloading `Source` with hundreds of text fields would break the one-node-per-document rule. Chunk text is never redistributed with the code (same boundary as the personal-library rule in strategy.md).

### Relationships

```
(Material)-[:COMPOSED_OF {stoichiometry, fraction}]->(Element)
(Material)-[:HAS_PROPERTY]->(PropertyValue)
(PropertyValue)-[:OF_TYPE]->(PropertyType)
(PropertyValue)-[:SOURCED_FROM]->(Source)
(Material)-[:USED_IN {source_id, confirmed: bool, basis (computed|literature|curated), quote, extraction_method}]->(Application)
(Application)-[:TAGGED_BY]->(Source)
(Application)-[:BELONGS_TO]->(Domain)
(Domain)-[:REQUIRES_PROPERTY {target_min, target_max, importance}]->(PropertyType)
(Application)-[:REQUIRES_PROPERTY {target_min, target_max, importance}]->(PropertyType)   // preferred by the feasibility tool; Domain-level is the fallback
(Material)-[:SIMILAR_TO {method, score, confirmed: bool, computed_at}]->(Material)
(Domain)-[:HAS_GAP]->(Gap)
(Gap)-[:DOCUMENTED_IN]->(Source)
(Chunk)-[:PART_OF]->(Source)
```

### 2.1 Provenance and confirmation semantics

Three independent flags describe how much to trust an edge or value; the GraphRAG layer reports all three.

| Flag | Lives on | Meaning |
|---|---|---|
| `source_type` | `PropertyValue` | *Epistemic basis* of the number: `measured` (experiment), `dft` (computed database), `mlip_predicted`, `literature_asserted` (a paper states it, provenance of the measurement unknown). |
| `basis` | `USED_IN` | How the application tag arose: `computed` (Materials Project enumerated the electrode — **not** an experimentally demonstrated application), `literature` (a paper says so), `curated` (hand-entered reference data, e.g. the electrolyte-molecule table). |
| `confirmed` | `PropertyValue`, `USED_IN`, `SIMILAR_TO`, `Gap` | A human accepted it (or it came from a deterministic database load). Everything produced by an LLM is written `confirmed=false` and stays so until `mg harvest review` accepts it. |

Merge keys: a `PropertyValue` is unique per `(Material, property_type, source_id, conditions)`, so two sources asserting the same property coexist as two nodes and the feasibility tool can report "sources disagree". A `USED_IN` edge is unique per `(Material, Application, source_id)`.

Material keys: Materials Project entries are `mp:<id>`; OPTIMADE entries that match an existing node on `(reduced_formula, spacegroup_number)` are attached to it (their id goes into `external_ids`), otherwise they become `oqmd:<id>` etc.; literature-only compositions become `lit:<reduced_formula>` stubs, with `SIMILAR_TO {method:'doped_variant_of'}` to the parent phase when the resolver recognises a doped variant; molecules are `mol:<inchikey>`.

### Constraints & indexes

The authoritative list is `src/materialsgraph/graph/schema.cypher` (one statement per line; the loader runs it verbatim and it is safe to re-run). Beyond the uniqueness constraints on every key above it defines lookup indexes on `Material.reduced_formula/kind/inchikey`, `PropertyValue.property_type/source_type/source_id/confirmed`, `Source.type/year/doi/openalex_id`, a full-text index over `Source.title+abstract` and `Chunk.text`, and two 384-dimensional cosine vector indexes (`source_abstract_embedding`, `chunk_embedding`). Vector indexes need Neo4j >= 5.15; `docker-compose.yml` pins `neo4j:5.26-community`.

### Battery-domain seed data (`src/materialsgraph/graph/reference.py`)

**Domain:** `Battery`
**PropertyTypes:** `ionic_conductivity` (S/cm), `voltage` (V), `specific_capacity` (mAh/g), `formation_energy` (eV/atom), `energy_above_hull` (eV/atom), `band_gap` (eV), `cycling_stability` (% retention), `electrochemical_window` (V), `activation_energy` (eV), `density` (g/cm3); for molecules `melting_point` (K), `boiling_point` (K), `dielectric_constant`, `viscosity` (mPa.s), `oxidation_potential` (V vs Li/Li+), `molecular_weight` (g/mol). Each carries a *plausible* range used by the harvester validator to reject unit/exponent mistakes.
**Applications:** `<ion>-ion insertion electrode` for Li/Na/K/Mg (computed, from MP), `Li-ion cathode`, `Na-ion cathode`, `anode material`, `solid electrolyte`, `polymer electrolyte host`, `liquid electrolyte solvent`, `electrolyte salt`, `electrolyte additive`. Each has aliases (for the resolver) and illustrative, reviewer-editable `REQUIRES_PROPERTY` targets, e.g. solid electrolyte: `ionic_conductivity >= 1e-4` (high), `energy_above_hull <= 0.05` (high), `band_gap >= 3.0` (medium).
**Elements:** the periodic table from pymatgen, flagged against the EU CRM 2023 and USGS 2022 critical lists.
**Seed Sources:** `materials-project`, `oqmd`, `liverpool-liion-database`, `pubchem`, `eu-crm-2023`, `usgs-critical-minerals-2022`.

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

## 3. Data harvester (structured sources + literature) and the review gate

"Scrape the internet" is deliberately **not** how more data gets in. General crawling is legally fragile (publisher terms, Google Scholar forbids it, copyright on full text), noisy, and produces facts nobody can verify. The harvester instead works three tiers of legitimate sources, each with provenance, and nothing an LLM produced reaches the graph as `confirmed=true` without a human.

| Tier | Source | What it yields | Access / licence notes |
|---|---|---|---|
| 1 | Materials Project (`mp-api`) | crystals, DFT `band_gap`, `formation_energy`, `energy_above_hull`, electrode `voltage`/`specific_capacity`, composition, spacegroup, for Li/Na/K/Mg | API key; CC-BY, GNoME subsets BY-NC (tagged) |
| 1 | OPTIMADE providers (OQMD first; JARVIS; AFLOW/NOMAD structures) | more crystals and a second DFT opinion; attached to MP nodes when `(reduced_formula, spacegroup)` matches | no key; 1 req/s; per-provider licence recorded from `/v1/info` |
| 1 | Liverpool Li-ion conductivity dataset (Hargreaves et al. 2023) | **measured** `ionic_conductivity` with temperature and a DOI per entry | open data; licence file recorded at ingest |
| 1 | PubChem PUG-REST | identifiers for electrolyte molecules (InChIKey, SMILES, MW) | public domain; <= 5 req/s |
| 2 | OpenAlex (primary), Semantic Scholar, CrossRef, arXiv | paper metadata + abstracts | OpenAlex CC0, `mailto` polite pool; S2 non-commercial research terms; arXiv 1 req/3 s |
| 2 | Unpaywall, Europe PMC, arXiv PDFs | open-access full text, **only when the licence is CC** | `pypdf` text extraction; PDFs cached under `data/fulltext/` (gitignored) |
| 3 | EU CRM 2023, USGS 2022 lists | `Element` criticality flags | public documents, hand-encoded |

Pipeline (`mg harvest ...`): **discover** (keywords x connectors -> de-duplicated `SourceRecord`s) -> **fulltext** (licence-gated PDF -> `Chunk`s) -> **extract** (local LLM via LM Studio, JSON-schema constrained: materials, property values with units/conditions/quote, `USED_IN` tags, `Gap` statements) -> **validate** (quote must appear verbatim in the text; unit normalisable; value within the PropertyType's plausible range; formula resolves; application resolves; optional Claude pass on survivors) -> **stage** (JSONL queue under `data/harvest/queue/`) -> **review** (`mg harvest review`: accept / reject / edit, no auto-accept) -> **commit** (accepted -> `confirmed=true`; optionally validated-pending -> `confirmed=false`; rejected -> removed). Accepted candidates are mirrored to `curated/<batch>.accepted.jsonl`, which is git-tracked and is the project's real dataset.

Entity resolution (`harvest/resolve.py`) is shared by the harvester, the dataset loaders and the query layer: alias tables (LLZO, NMC811, LiPF6...) -> variable detection (`x`, `δ`) -> pymatgen parse -> canonical reduced formula -> graph lookup with polymorph disambiguation -> doped-variant heuristic -> `lit:` stub.

### Literature & book scout (unchanged, discovery-only)

`enrichment/book_scout.py` still ranks recent vs foundational books/papers for the reader; its Semantic Scholar helpers are reused by the harvester's S2 connector. Starter shortlist: *Computational Design of Battery Materials* (Springer 2025); Strauss et al., "2026 roadmap on next-generation solid electrolytes" (DOI 10.1088/2752-5724/ae5120) — roadmap papers are the richest seed for `Gap` nodes; Zaghib 2026 (DOI 10.1002/adma.202513255); Armand et al. 2026 (DOI 10.1002/adma.73750).

## 3.5 GraphRAG query layer (`query/`)

A LangGraph agent (`query/graphrag.py`): `route -> run_tool -> retrieve -> synthesize`. The router (local LLM, typed `RouteDecision`) picks one use case and extracts its parameters; each use case is a tool whose Cypher is assembled from allow-listed fragments with user input passed only as parameters:

1. **screening** — materials identification: element include/exclude, stability cap, N property constraints, optional application; ranked rows carry `source_type`/`confirmed`/`source_id` per value.
2. **feasibility** — one material vs one application's `REQUIRES_PROPERTY` targets: each requirement is `met | unmet | missing | conflicting` (sources disagree by > 1 order of magnitude on log-scale properties); the verdict is computed deterministically, the LLM only narrates it; `USED_IN` basis, `SIMILAR_TO` neighbours and `Gap`s are attached.
3. **composition** — element breakdown with critical-element fraction, single-site substitution candidates, similarity neighbours; for molecules, identifiers, roles and co-occurring species.
4. **literature** — hybrid retrieval (vector over `Source.abstract_embedding` and `Chunk.embedding` + full-text index, reciprocal-rank fusion) expanded into the values, tags and gaps those sources support.
5. **gaps** — coverage per required property plus `Gap` nodes for an application or the domain.
6. **freeform** — the LLM writes Cypher, `query/cypher_safety.validate_read_only` rejects writes/procedures and bounds `LIMIT`, the statement is `EXPLAIN`ed and run in a read transaction.

Every numeric claim in an answer must carry a `[source_id]`; citations not present in the retrieved set are stripped and reported. Answers end with a Confidence block (source type + confirmed per cited value).

## 4. Repo structure

```
materialsgraph/
├── CLAUDE.md
├── README.md
├── Makefile
├── docs/                          # strategy.md, full_vision.md, technical_buildplan.md, harvester_graphrag_plan.md
├── curated/                       # accepted harvest candidates (JSONL, git-tracked)
├── src/materialsgraph/
│   ├── cli.py                     # `mg` entrypoint: schema | ingest | load | harvest | embed | similar | ask | query | summary
│   ├── chem.py                    # pymatgen helpers: canonical reduced formula, composition parsing, variable detection
│   ├── graph/
│   │   ├── schema.cypher          # constraints / indexes (one statement per line)
│   │   ├── reference.py           # Domain, PropertyTypes (+plausible ranges), Applications (+aliases, targets), critical elements, seed Sources
│   │   ├── connection.py          # driver / session helpers
│   │   ├── writers.py             # every MERGE in the codebase, keyed 1:1 to constraints
│   │   └── queries.py             # read templates incl. the gap query, material_profile, requirements_for, expand_sources
│   ├── ingestion/
│   │   ├── models.py              # RawMaterialRecord, ExternalPropertyRecord, MeasuredPropertyRecord, MoleculeRecord
│   │   ├── mp_client.py           # Materials Project pull, Li/Na/K/Mg, composition + spacegroup
│   │   ├── optimade_client.py     # OQMD / JARVIS / AFLOW / NOMAD via OPTIMADE
│   │   ├── liverpool_ionics.py    # measured Li solid-electrolyte conductivities
│   │   ├── pubchem_client.py      # molecule identifiers
│   │   ├── elements.py            # periodic table + criticality flags
│   │   └── schema_loader.py       # apply schema, seed reference data, load all record types
│   ├── harvest/
│   │   ├── models.py              # SourceRecord, Candidate* staging models, LLM extraction schema
│   │   ├── connectors/            # openalex, semantic_scholar, crossref, arxiv, unpaywall, europepmc (+ base: rate limits, licence gate)
│   │   ├── discover.py, fulltext.py, extract.py, validate.py, stage.py, review_cli.py, commit.py
│   │   ├── resolve.py, aliases.py, units.py, normalize.py
│   │   └── prompts/extract_v1.md
│   ├── enrichment/
│   │   ├── literature_agent.py    # run_harvest: discover -> fulltext -> extract -> validate -> stage
│   │   ├── embeddings.py          # sentence-transformers (384-d) for Sources and Chunks
│   │   ├── similarity.py          # composition-cosine SIMILAR_TO (confirmed=false)
│   │   └── book_scout.py
│   ├── query/
│   │   ├── graphrag.py            # LangGraph agent
│   │   ├── tools.py               # screening, feasibility, composition, literature, gaps
│   │   ├── schemas.py             # typed params, RouteDecision, Answer
│   │   ├── cypher_safety.py       # read-only validator + executor
│   │   └── nl_to_cypher.py        # freeform fallback + `mg ask` CLI
│   └── llm/
│       ├── local_client.py        # LM Studio StructuredLLM (pydantic-constrained JSON, retries)
│       └── cloud_client.py        # Claude validation pass only
├── tests/                         # unit (no services), integration (skipped without Neo4j), eval/questions.jsonl
├── docker-compose.yml             # neo4j:5.26-community
├── pyproject.toml
└── .env.example
```

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
