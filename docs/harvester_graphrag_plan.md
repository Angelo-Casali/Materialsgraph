# Harvester + GraphRAG: feasibility assessment and implementation plan

## Context

The repo today has a working but thin Stage 1 skeleton: a Materials Project pull of ~150
Li insertion-electrode materials (`src/materialsgraph/ingestion/mp_client.py`), a Neo4j
loader that applies `schema.cypher` and writes per-material `PropertyValue` nodes
(`ingestion/schema_loader.py`), four read queries (`graph/queries.py`), and a
metadata-only literature scout (`enrichment/book_scout.py`). The LLM clients, the
literature enrichment agent and the NL-to-Cypher agent are docstring-only stubs. No tests,
no README, no `Element`/`COMPOSED_OF`/`Gap`/`SIMILAR_TO` data, and no `confirmed=false`
edges because nothing AI-derived has ever been written.

The user wants (1) an algorithm that gathers more data from the internet to fill the graph,
(2) a GraphRAG layer organised around real use cases (materials identification, feasibility
study, molecular/compositional analysis), (3) an honest view of feasibility and usefulness.
Decisions taken with the user: **battery domain only; molecular species (electrolyte
solvents, salts, additives, polymers) in scope; open-access full text in scope on top of
structured APIs and abstracts; harvester before GraphRAG.**

**Reframing "scrape the internet".** A general web crawler is the wrong tool: legally fragile
(publisher ToS, Google Scholar forbids it, copyright on full text), noisy, and it yields
unverifiable facts. The valuable data lives behind free, licensed, structured APIs and
open-access repositories. The plan builds a **harvester**: connectors over legitimate
sources -> local-LLM extraction -> deterministic validation -> human review queue ->
committer that respects the repo's hard rules (`confirmed=false` for anything AI-derived,
no writes outside `schema.cypher`, buildplan updated before any schema change).

## Honest feasibility and usefulness assessment

**Feasible within Stage 1 for a solo developer at <5h/week, roughly 70-80 h / 16-20 weeks:**
- Material coverage from 150 to several thousand battery-relevant entries via Materials
  Project (Na/K/Mg ions, compositions, spacegroups) and OPTIMADE (OQMD first). Low risk.
- Literature metadata + abstracts via OpenAlex (free, no key, abstracts for ~60-70% of
  works), Semantic Scholar (exists), CrossRef, arXiv. Low risk.
- Open-access full text via Unpaywall + arXiv + Europe PMC, **CC-licensed papers only**,
  parsed with `pypdf`, chunked, embedded. Medium risk: PDF table/figure extraction is poor;
  expect prose-level facts, not tables. Budget real time for it.
- Local-LLM extraction of `USED_IN`, literature-asserted property values with conditions,
  and `Gap` statements from roadmap/review papers. Medium risk: 8-14B models get maybe
  60-80% of numeric values right before review (units/exponents are the failure mode).
  `USED_IN` and `Gap` extraction works much better than numbers. The review queue is what
  makes this acceptable and is not optional.
- Molecular species as `Material {kind:'molecule'}` with PubChem identifiers. Feasible;
  PubChem PUG-REST is free. Their property data will come almost entirely from literature.
- GraphRAG: Neo4j 5 native vector + fulltext indexes, Cypher templates per use case, one
  guarded freeform NL-to-Cypher fallback, in LangGraph. Feasible; answer quality depends on
  data volume, hence harvester first.

**Not in this plan:** general crawling; paywalled text; DFT/MLIP prediction; RDKit-level
molecular descriptors (Stage 2); any output the user would need to trust without review.

**Is it useful for the world?** Partially, if focused.
- Already served, do not compete: computed properties (Materials Project, OQMD, AFLOW,
  JARVIS, NOMAD), generative discovery (GNoME, MatterGen), commercial informatics
  (Citrine, Springer Materials), cycling datasets (Battery Archive, Battery Data Genome).
- Under-served, where this adds value: a **reviewable, provenance-first link between
  computed data, measured/literature-asserted values, application tags, requirement targets
  and explicit gaps**, queryable in natural language. "Has anyone measured ionic
  conductivity for this candidate, under what conditions, does it meet the solid-electrolyte
  target, and who says this is still an open problem?" No free tool answers that today. Real
  time saver for students, small labs and early R&D screening; a portfolio demo rather than
  a product for large industry. The feasibility-study use case is the headline, not data
  volume. The curated accepted-candidates JSONL (git-tracked) becomes a small citable
  dataset in itself.
- Highest value-per-hour single item: the Liverpool LiIonDatabase of **measured** Li
  solid-electrolyte conductivities (open data, per-entry DOIs; verify license at ingest).
  It fills the headline `ionic_conductivity` gap with measured values that abstract
  extraction never will at scale.

## Verified code facts driving the refactor

- `graph/queries.py:11` imports `APPLICATION_NAME` from `schema_loader`, which imports
  `mp_client`, which imports `mp_api` at module top. Read-only queries drag in mp-api.
- `schema_loader._set_property_value` (lines 154-183) hardcodes `source_type='dft'`,
  `MP_SOURCE_ID`, `confidence='high'`; MERGE key `{property_type, source_type}` per material
  means two sources asserting the same property collide.
- Every Material lookup is `{mp_id: ...}`; non-MP materials cannot exist.
- `USED_IN` has only `{confirmed:true}`; no per-edge source -> GraphRAG cannot cite it. MP
  "insertion electrode" means computationally enumerated, not demonstrated.
- `schema_loader._read_schema_statements` (lines 63-76) is line-based: every schema
  statement must be on one line.
- `book_scout._fetch_papers/_normalize_paper/_dedupe_by_title/_parse_leading_year` are
  reusable for the Semantic Scholar connector.
- Driver boilerplate duplicated in `schema_loader.main` and `queries.__main__`.

## Schema changes (buildplan §2 first, then `schema.cypher`, one statement per line)

New statements:
```
CREATE CONSTRAINT material_key IF NOT EXISTS FOR (m:Material) REQUIRE m.material_key IS UNIQUE;
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.chunk_id IS UNIQUE;
CREATE INDEX material_reduced_formula IF NOT EXISTS FOR (m:Material) ON (m.reduced_formula);
CREATE INDEX material_kind IF NOT EXISTS FOR (m:Material) ON (m.kind);
CREATE INDEX material_inchikey IF NOT EXISTS FOR (m:Material) ON (m.inchikey);
CREATE INDEX propvalue_source_id IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.source_id);
CREATE INDEX propvalue_confirmed IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.confirmed);
CREATE INDEX source_doi IF NOT EXISTS FOR (s:Source) ON (s.doi);
CREATE FULLTEXT INDEX source_text IF NOT EXISTS FOR (s:Source) ON EACH [s.title, s.abstract];
CREATE VECTOR INDEX source_abstract_embedding IF NOT EXISTS FOR (s:Source) ON (s.abstract_embedding) OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: 'cosine'}};
CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS FOR (c:Chunk) ON (c.embedding) OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: 'cosine'}};
```
Keep `material_mp_id` (uniqueness ignores nulls). Pin `docker-compose.yml` to
`neo4j:5.26-community` so vector-index syntax is reproducible.

Property additions (document in `docs/technical_buildplan.md` §2, add §2.1 "Provenance and
confirmation semantics"):
- `Material`: `material_key` (namespaced `mp:` / `oqmd:` / `lit:<reduced_formula>[|<spacegroup>]`
  / `mol:<inchikey>`), `reduced_formula`, `spacegroup`, `spacegroup_number`, `kind`
  (`crystal`|`molecule`), `smiles`, `inchikey`, `common_name`, `external_ids`, `data_source`,
  `license`, `provider`.
- `PropertyValue`: `source_id` (merge key), `conditions` (JSON string, `""` default; MERGE
  rejects nulls), `extraction_method`, `quote`, `confirmed`. Merge key becomes
  `(material, property_type, source_id, conditions)`.
- `Source`: `doi`, `abstract`, `abstract_embedding`, `license`, `openalex_id`, `is_oa`,
  `oa_pdf_url`, `provider`; `type` gains `database`, `preprint`.
- **New label `Chunk`** (`chunk_id`, `text`, `embedding`, `section`, `page`, `ordinal`) with
  `(Chunk)-[:PART_OF]->(Source)`. Justified by the full-text decision; added to the
  buildplan §2 table explicitly, as the CLAUDE.md rule requires. Chunk text is stored only
  for CC-licensed sources; `data/fulltext/` stays gitignored.
- `Element`: `eu_crm_2023`, `usgs_2022` booleans (hand-encoded public lists).
- `Gap`: `status`, `application`, `extraction_method`.
- `USED_IN`: `source_id`, `basis` (`computed`|`literature`|`curated`), `quote`,
  `extraction_method`; one edge per `(material, application, source_id)`.
- `REQUIRES_PROPERTY` also allowed from `Application`; feasibility prefers Application-level
  targets, falls back to Domain-level.
- New PropertyTypes (reference data): `electrochemical_window` (V), `activation_energy`
  (eV), `density` (g/cm3), and for molecules `melting_point` (K), `boiling_point` (K),
  `dielectric_constant`, `viscosity` (mPa·s), `oxidation_potential` (V vs Li/Li+).
- New Applications: per-ion insertion electrodes, `Li-ion cathode`, `Na-ion cathode`,
  `anode material`, `solid electrolyte`, `liquid electrolyte solvent`, `electrolyte salt`,
  `electrolyte additive`, `polymer electrolyte host`, each with aliases and optional
  requirement targets (e.g. solid electrolyte: `ionic_conductivity >= 1e-4` high,
  `energy_above_hull <= 0.05` high, `band_gap >= 3.0` medium).

Migration: MERGE key change means re-running on legacy nodes would duplicate PVs. Phase 0
does `mg schema reset && mg load` (150 regenerable records); an idempotent `backfill_v2`
is also provided.

## Module plan

Single console entrypoint `mg` (`[project.scripts] mg = "materialsgraph.cli:main"`).

**graph/** (only package that writes to Neo4j)
- NEW `graph/reference.py`: constants moved out of `schema_loader` (`DOMAIN_NAME`,
  `MP_SOURCE_ID`, `PROPERTY_TYPES` + `plausible_min/max`, `REQUIRED_PROPERTIES`,
  `APPLICATIONS` dict with aliases/requires, `CRITICAL_ELEMENTS`, `SOURCE_TYPES`,
  `PV_SOURCE_TYPES`). Zero heavy imports. Keep `APPLICATION_NAME` alias.
- NEW `graph/connection.py`: `get_driver()`, `session()` context manager, `neo4j_reachable()`.
- NEW `graph/writers.py`: every MERGE lives here, keyed 1:1 to constraints:
  `upsert_material`, `upsert_composed_of`, `upsert_property_value` (generalised
  `_set_property_value`, validates property/source types before DB), `upsert_source`,
  `set_source_embedding`, `upsert_chunks`, `upsert_used_in`, `upsert_similar_to`,
  `upsert_gap`, `set_confirmed`, `delete_candidate_edge`, `reset_graph` (explicit flag).
- MODIFY `graph/queries.py`: import from `reference`; return `material_key`; add read
  templates `screen_materials`, `material_profile`, `feasibility_rows`, `composition_rows`,
  `expand_sources`, `gap_rows`.
- MODIFY `graph/schema.cypher` as above.

**ingestion/** (Tier 1 structured, no LLM)
- NEW `ingestion/models.py`: `RawMaterialRecord` moved + extended (`material_key`,
  `reduced_formula`, `spacegroup*`, `composition`, `license`, `provider`); re-export from
  `mp_client`. `ExternalPropertyRecord` for OPTIMADE.
- MODIFY `ingestion/mp_client.py`: `WORKING_IONS = ["Li","Na","K","Mg"]`, add
  `composition_reduced`, `symmetry`, `elements`, `is_stable` fields; `material_key=f"mp:{id}"`;
  canonical `reduced_formula` via `pymatgen.Composition`.
- NEW `ingestion/elements.py`: seed periodic table from pymatgen + critical-element flags.
- NEW `ingestion/optimade_client.py`: raw `requests`, OPTIMADE v1, OQMD field map
  (`_oqmd_delta_e`, `_oqmd_band_gap`, `_oqmd_stability`), 1 req/s, honours `links.next`,
  records `/v1/info` license on the Source. Resolve-then-attach: match existing MP node on
  `(reduced_formula, spacegroup_number)` and attach PVs; else create `oqmd:` node.
- NEW `ingestion/liverpool_ionics.py`: Liverpool LiIonDatabase CSV -> `measured`
  `ionic_conductivity` PVs with `conditions='{"temperature_K":...}'`, one Source per DOI.
- NEW `ingestion/pubchem_client.py`: PUG-REST lookup by name/formula -> `inchikey`,
  `smiles`, `molecular_weight`; <=5 req/s. Used by the molecule alias table and resolver.
- MODIFY `ingestion/schema_loader.py`: thin: `apply_schema`, `seed_reference_data` (all
  Applications, Elements, provider Sources), `backfill_v2`, loaders delegating to
  `graph.writers`. Delete `_set_property_value`.

**harvest/** (NEW package, Tier 2 literature)
- `models.py`: `SourceRecord`, `Check`, `ValidationResult`, `Resolution`, `ReviewDecision`,
  `CandidateBase` + `CandidateMaterial` / `CandidatePropertyValue` / `CandidateUsedIn` /
  `CandidateGap` (discriminated union on `kind`), `ExtractionOutput` (LLM-facing stripped
  variant).
- `connectors/base.py` (`LiteratureConnector` protocol, `RateLimiter`, polite headers),
  `openalex.py` (works search, inverted-index abstract reconstruction, `source_id =
  "doi:<lower>"` else `"openalex:W..."`, OA license + pdf url), `semantic_scholar.py` (wraps
  `book_scout._fetch_papers/_normalize_paper`), `crossref.py` (DOI metadata completion),
  `arxiv.py` (Atom, `cond-mat.mtrl-sci`, 3 s interval), `unpaywall.py` (OA location; download
  only if license in `{cc-by, cc-by-sa, cc0, public-domain}`), `europepmc.py` (OA full text).
- `fulltext.py`: `pypdf` text extraction (BSD; not PyMuPDF/AGPL), section-aware chunking
  (~800 tokens, 100 overlap), `chunk_id = sha1(source_id|ordinal)`; cache in
  `data/fulltext/`.
- `normalize.py` (DOI normalisation, dedupe by DOI then title), `aliases.py`
  (`FORMULA_ALIASES`: LLZO, LLZTO, LGPS, LATP, LLTO, LiPON, NMC811/622, NCA, LCO, LFP, LMO,
  LNMO, LTO, NASICON...; `MOLECULE_ALIASES`: LiPF6, LiTFSI, LiFSI, EC, DMC, DEC, EMC, FEC,
  VC, PEO with inchikey filled via PubChem), `units.py` (mS/cm, S m-1, "10^-3 S/cm",
  mAh g-1 etc. -> canonical unit; rejects Wh/kg for capacity).
- `resolve.py`: `resolve_formula(raw, session) -> Resolution`, order: alias table ->
  variable detection (`x`, `δ`, `1-x`) -> `pymatgen.Composition` parse -> canonical
  `reduced_formula` -> graph lookup (polymorph disambiguation by spacegroup, else lowest
  `energy_above_hull`, status `ambiguous`) -> doped-variant heuristic (superset-minus-one
  element set, same anion, cosine >= 0.9 -> `lit:` stub + `SIMILAR_TO
  {method:'doped_variant_of', confirmed:false}`) -> optional live MP lookup -> `new_crystal`
  / `new_molecule` (PubChem lookup for `mol:<inchikey>`).
- `discover.py` (keywords x connectors -> `data/harvest/sources/<batch>.jsonl`),
  `extract.py` (one `StructuredLLM.complete(ExtractionOutput)` call per abstract or chunk;
  prompt in `harvest/prompts/extract_v1.md`; `extraction_method="lmstudio:<model>@v1"`),
  `validate.py` (quote must be substring of source text; property in reference; unit
  normalisable; value within plausible range; application resolvable; optional
  `cloud_validate` via Claude), `stage.py` (JSONL queue, atomic rewrite),
  `review_cli.py` (stdlib `input` loop: accept / reject / edit / skip / quit, filters by
  kind/status; no auto-accept by design), `commit.py` (accepted -> `confirmed=True`;
  `--include-pending` writes pending edges/PVs `confirmed=False` only when the material
  already exists; materials and gaps only on acceptance; mirrors accepted to
  `curated/<batch>.accepted.jsonl`, git-tracked).
- MODIFY `enrichment/literature_agent.py`: orchestrator `run_harvest(...)`:
  discover -> fetch_fulltext (optional) -> extract -> validate -> stage. Plain function
  sequence first; LangGraph only if retries/branching are needed.
- NEW `enrichment/embeddings.py` (`sentence-transformers/all-MiniLM-L6-v2`, 384-dim,
  `embed_sources`, `embed_chunks`), `enrichment/similarity.py` (element-fraction cosine ->
  `SIMILAR_TO {confirmed:false}`, `link_doped_variants`).

**llm/**
- `llm/local_client.py`: OpenAI SDK at `LM_STUDIO_BASE_URL`; `StructuredLLM.complete(schema,
  system, user)` tries `json_schema` strict mode, falls back to `json_object` with schema in
  prompt, re-prompts on `ValidationError`, raises after retries. Injectable for tests.
- `llm/cloud_client.py`: `validate_candidates(batch)` via `anthropic` SDK, batched ~20,
  only from `mg harvest validate --cloud`. Never used for extraction or answering.

**query/** (GraphRAG)
- `cypher_safety.py`: `validate_read_only(cypher, max_limit=200)`: strip literals/comments;
  reject `CREATE MERGE DELETE DETACH SET REMOVE DROP FOREACH LOAD CSV CALL { apoc. dbms.`
  and any `db.` outside the allowlist (`db.index.vector.queryNodes`,
  `db.index.fulltext.queryNodes`); reject `;`; first token in `MATCH/OPTIONAL/WITH/UNWIND/
  CALL/RETURN`; enforce LIMIT. Execution always via `session.execute_read` with timeout
  (second line of defence).
- `schemas.py`: `ScreeningParams`, `FeasibilityParams`, `CompositionParams`,
  `LiteratureParams`, `GapParams`, `RouteDecision`.
- `tools.py`: one function per use case, Cypher assembled from allowlisted fragments +
  parameters only.
  1. **Materials identification / screening**: element include/exclude via `COMPOSED_OF`,
     `energy_above_hull` cap, N property constraints, optional application; ranked rows with
     `source_type`, `confirmed`, `source_id` per value.
  2. **Feasibility study**: Application-level (else Domain) `REQUIRES_PROPERTY` targets vs
     all PVs; classify met / unmet / missing / conflicting (sources disagree > 1 order of
     magnitude on log-scale props); `USED_IN` with `basis`; `SIMILAR_TO` neighbours; Gaps.
     Verdict computed deterministically; LLM only narrates.
  3. **Compositional / molecular analysis**: `COMPOSED_OF` with critical-element flags and
     fraction; `SIMILAR_TO`; substitution candidates (all-but-one element, same anion). For
     `kind='molecule'`: identifiers, role applications, literature PVs, co-occurring salts/
     solvents from shared Sources.
  4. **Literature-grounded Q&A**: vector + fulltext retrieval over Source abstracts and
     Chunks, reciprocal-rank fusion, then `expand_sources` to PVs / USED_IN / Gaps / Materials.
  5. **Gap / coverage report**: reuse `queries.get_property_coverage`,
     `queries.get_missing_property`, plus `HAS_GAP -> DOCUMENTED_IN`.
  6. **Freeform fallback**: `nl_to_cypher.generate_cypher` -> `validate_read_only` ->
     `EXPLAIN` -> `execute_read`.
- `graphrag.py`: LangGraph `StateGraph` with `route -> resolve_entities -> <tool> ->
  vector_retrieve (hybrid, for screening/feasibility too) -> synthesize`. Synthesis
  template: every numeric claim carries `[source_id]`; mandatory Confidence block listing
  `source_type` and `confirmed` per cited value; citations not in the retrieved set are
  stripped and flagged. `answer(question) -> Answer(text, citations, confidence_notes,
  cypher_used)`.
- MODIFY `query/nl_to_cypher.py`: fallback generator + CLI `mg ask "..." [--use-case]
  [--show-cypher]`.

**Root / tooling**: `src/materialsgraph/cli.py` (argparse: `mg schema apply|reset|backfill`,
`mg ingest mp|optimade|elements|liverpool|pubchem`, `mg load`, `mg harvest
discover|fulltext|extract|validate|review|commit|stats`, `mg embed`, `mg similar`, `mg ask`);
`tests/conftest.py` (neo4j skip marker, fake LLM fixture, fixture JSON for OpenAlex/MP/OQMD/
PubChem), `tests/unit/`, `tests/integration/`, `tests/eval/questions.jsonl`; `README.md`,
`Makefile`, `.env.example` (+ `OPENALEX_MAILTO`, `UNPAYWALL_EMAIL`, `SEMANTIC_SCHOLAR_API_KEY`,
`LM_STUDIO_MODEL`, `EMBEDDING_MODEL`, `ANTHROPIC_MODEL`), `pyproject.toml` (scripts, extras
`fulltext=["pypdf"]`, dev `ruff`), `curated/.gitkeep`.

## Connector rate limits / licensing to encode

| Connector | Auth | Limit | License note |
|---|---|---|---|
| Materials Project | key | client throttles | CC-BY; GNoME BY-NC already tagged via `data_source` |
| OPTIMADE (OQMD, then AFLOW/JARVIS/NOMAD) | none | 1 req/s, page_limit<=50 | per-provider; store `/v1/info` license on Source; unknown = do not redistribute |
| OpenAlex | `mailto` | 10 req/s, cursor paging | CC0 metadata |
| Semantic Scholar | optional key | 1 req/s (keep `sleep(1)`) | non-commercial research; store only extractions |
| CrossRef | `mailto` UA | 2 req/s | metadata only |
| arXiv | none | 1 req / 3 s | abstracts free; PDFs per-paper license |
| Unpaywall / Europe PMC | email | 100k/day | download only CC-licensed; cache gitignored |
| PubChem PUG-REST | none | <=5 req/s | public domain |
| EU CRM 2023 / USGS 2022 | n/a | constants | public documents, cited via Source nodes |
| Liverpool LiIonDatabase | n/a | one CSV | verify repo license at ingest; per-entry DOIs |

Never fetch HTML search pages (no Google Scholar, no publisher HTML).

## Phases (each demoable; ~<5h/week)

| # | Phase | ~h | Key deliverables |
|---|---|---|---|
| 0 | Foundations & refactor | 4 | `reference.py`, `connection.py`, `writers.py`, `models.py`, queries import fix, `mg`, conftest, README, Makefile, compose pin, `schema reset && load` |
| 1 | Schema v2 + Elements + MP extension | 8 | buildplan §2/§2.1, schema.cypher (non-vector), `elements.py`, Na/K/Mg, `COMPOSED_OF`, Applications + targets, `USED_IN.basis` |
| 2 | OPTIMADE + Liverpool + resolver core | 10 | `optimade_client.py`, `liverpool_ionics.py`, `resolve.py` steps 3-5, `units.py` |
| 3 | LLM plumbing + OpenAlex + embeddings + retrieval | 8 | `local_client.py`, `embeddings.py`, `openalex.py`, `semantic_scholar.py`, `discover.py`, vector/fulltext indexes, literature tool (no synthesis) |
| 4 | Extraction, validation, review, commit | 12 | `extract.py` + prompt, `validate.py`, `aliases.py`, resolver steps 1-2 & 6-8, `stage.py`, `review_cli.py`, `commit.py`, `run_harvest` |
| 5 | Molecules | 6 | `pubchem_client.py`, molecule aliases, `kind='molecule'`, molecule PropertyTypes/Applications, resolver `new_molecule` |
| 6 | Open-access full text | 8 | `unpaywall.py`, `europepmc.py`, `arxiv.py` PDFs, `fulltext.py`, `Chunk` label + index, chunk extraction & embedding |
| 7 | GraphRAG core | 10 | `cypher_safety.py`, `schemas.py`, `tools.py` (screening, feasibility, gaps, literature), `graphrag.py`, freeform fallback |
| 8 | Composition analysis + SIMILAR_TO + cloud validator | 6 | `similarity.py`, composition tool, doped-variant links, `cloud_client.validate_candidates` |
| 9 | Hardening | 4 | 15-question golden eval, README walkthrough, buildplan §3/§4, ruff |

**Cut order if time runs short** (first to go first): cloud validator -> arXiv/CrossRef
connectors -> composition SIMILAR_TO -> freeform NL-to-Cypher (keep templated tools) ->
OPTIMADE beyond OQMD -> full text (Phase 6) -> molecules (Phase 5). Never cut: Phase 0,
`material_key`/provenance schema, review gate, Cypher-safety validator, Liverpool dataset.

## Verification

- **Phase 0**: `python -c "import materialsgraph.graph.queries"` works without `mp_api`;
  `pytest -q` green; after `mg schema reset && mg load`,
  `MATCH (m:Material) WHERE m.material_key IS NULL RETURN count(m)` = 0 and coverage output
  matches today's 150 materials.
- **Phase 1**: `mg ingest mp --ions Li,Na` writes two files; `mg load`;
  `MATCH (m:Material {reduced_formula:'LiFePO4'})-[c:COMPOSED_OF]->(e) RETURN e.symbol,
  c.stoichiometry, e.eu_crm_2023` returns 4 rows with Li flagged; integration
  `test_writers_roundtrip` passes.
- **Phase 2**: `mg ingest optimade --provider oqmd --filter 'elements HAS ALL "Li","O" AND
  nelements<=4' --max-pages 5`; materials with both MP and OQMD `formation_energy` PVs
  exist; `mg ingest liverpool` yields `measured` conductivities with temperatures;
  `resolve_formula("FeLiO4P").reduced_formula == "LiFePO4"` unit test.
- **Phase 3**: `mg harvest discover --keywords "halide solid electrolyte" --since 2023
  --limit 100` prints abstract yield %; `mg embed`; `mg ask --use-case literature "argyrodite
  conductivity"` lists ranked sources; unit tests for inverted-index reconstruction, DOI
  normalisation, `StructuredLLM` retry with fake client.
- **Phase 4**: `mg harvest extract --max 50`, `mg harvest stats` (target validation pass
  >= 60% property values, >= 85% used_in), `mg harvest review`, `mg harvest commit`;
  `ionic_conductivity` coverage > 0 for solid electrolyte; Gaps from the 2026 roadmap DOI
  in the buildplan appear with `DOCUMENTED_IN`; `curated/<batch>.accepted.jsonl` exists;
  `MATCH ()-[r:USED_IN]->() WHERE r.basis='literature' AND r.confirmed AND r.source_id IS
  NULL RETURN count(r)` = 0. Measure extraction precision on a 30-abstract hand-labelled
  set per candidate local model before scaling.
- **Phase 5**: `MATCH (m:Material {kind:'molecule'}) RETURN m.common_name, m.inchikey`
  returns the alias table; `mg ask "what is LiTFSI used for"` resolves to `mol:` key.
- **Phase 6**: only CC-licensed PDFs land in `data/fulltext/`; `MATCH (c:Chunk)-[:PART_OF]->
  (s) WHERE s.license IS NULL RETURN count(c)` = 0; chunk retrieval surfaces a value absent
  from the abstract.
- **Phase 7**: `mg ask "stable Li cathodes without Co with capacity above 150 mAh/g"`
  returns a ranked table with `[source_id]`s; `mg ask "is Li7La3Zr2O12 feasible as a solid
  electrolyte"` returns met/unmet/missing + Confidence block; `tests/unit/test_cypher_safety.py`
  (>= 15 cases) and `test_router.py` (fake LLM, 10 questions) green; integration test runs
  every template through `EXPLAIN`.
- **Phase 8**: `MATCH ()-[r:SIMILAR_TO]->() WHERE r.confirmed RETURN count(r)` = 0;
  `mg ask "critical-element exposure of LiNi0.8Co0.1Mn0.1O2"` lists Li/Ni/Co/Mn with flags.
- **Phase 9**: `pytest tests/eval` passes routing + citation-count expectations on the
  golden set; `ruff check` clean.
