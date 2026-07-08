# MaterialsGraph — Project Strategy (v1)

*A scoped, realistic plan replacing the original "MatForge" full-stack pitch. Working title, change it if you land on something better.*

---

## Executive Summary

**MaterialsGraph** is a personal knowledge graph over materials-science data (batteries, carbon capture, circular-economy/critical-material alternatives), built primarily to develop hands-on skills your day job doesn't currently exercise — structured data engineering, domain ontology design, applied ML — not to chase a startup outcome.

**Core idea:** combine Materials Project's computed property data with a curated graph (Neo4j) and a RAG enrichment layer that pulls context from open literature plus your own books and video courses, so the graph carries not just *what* a material's properties are but *why it matters and where it's used* — always behind a human-review step before anything is written in.

**Committed scope — v1 (~11–13 weeks at under 5h/week):** data pipeline → schema → graph → enrichment → natural-language query layer. Fully specified below.

**Everything past v1** — predictive ML, an MCP tool interface, a front-end, deployment — is mapped out for orientation, not because it's scheduled. Pick it up only if v1 still excites you once it exists.

---

## Why

- **Primary driver: learning by doing.** You want hands-on practice with something missing from day-to-day work at FEM — not a resume stunt, not a startup pitch. Success is measured by what you learn and whether you're proud of it, not by outside validation.
- **Secondary, honest benefit:** if it turns out well, it's a legitimate demonstration of GraphRAG applied outside education — useful later, but not the design constraint. Don't let "will this impress a recruiter" creep back into scope decisions.
- **Hard constraint acknowledged up front:** under 5 hours/week alongside your job, the GenAI4ED review, and the renovation. Every phase below is sized against that, not against what would be ideal with unlimited time.

---

## What (Scope)

### In scope — v1

One connected knowledge graph, not three separate projects, spanning:
- Battery / energy storage materials
- Carbon capture / sustainability materials (MOFs, sorbents)
- Circular economy / critical-material-alternative materials

These share one schema and one data source (Materials Project), so "broad" doesn't multiply the work — it just means richer filtering and tagging on the same pipeline.

**Tentative node types:** `Material`, `Element`, `Property`, `Structure`, `Application`
**Tentative relationships:** `HAS_PROPERTY`, `COMPOSED_OF`, `SIMILAR_TO`, `USED_IN`
*(Refine these during Phase 2 — don't lock them in before looking at real data.)*

**Two pieces that make this more than a database mirror:**
1. **Offline RAG enrichment step** — Materials Project doesn't label materials by application. A small retrieval pipeline over abstracts/literature *and your own books/video courses* proposes `USED_IN` tags and context for you to review before writing them into the graph. This is curation, not a chatbot — the actual differentiated use of RAG here.
2. **NL-to-Cypher query layer** (later, reusing LangGraph) — proves the graph is genuinely queryable in plain language, not just populated.

### Explicitly out of scope for v1

- Django/HTMX web front-end
- Docker, CI/CD, deployment
- Predictive ML models (structure → property)
- MCP packaging / exposing it as a tool
- Personal branding push (LinkedIn article, etc.)

These are real phase-2/3 ideas, not deleted — just parked until v1 has a working checkpoint and you still want to keep going.

### Parked, not abandoned: formulation chemistry

A schema for formulation R&D (`Formulation`, `Component`, `ProcessParameter`, `PerformanceMetric`) is worth designing as a generalizable pattern — it's a strong "next job" pitch ("I already have this modeled, I just need your data"). But:
- There's no public equivalent of Materials Project for formulations — data is overwhelmingly proprietary.
- Any formulation know-how from NEOS or Marazzi belongs to those companies, not to a personal public project. Design the schema; don't populate it with anything derived from that work.

---

## How (Technical approach)

| Layer | Approach |
|---|---|
| **Data source** | Materials Project API (`mp-api` / `pymatgen`), free with registration. Pull a few hundred–low thousand records, filtered per domain (e.g., band-gap/voltage ranges for battery candidates, pore/adsorption-relevant structures for MOFs, non-rare-earth compositions for circular economy). |
| **Domain literature** | Books/video courses you own: parse PDFs/EPUBs (OCR if scanned) and transcribe videos (e.g. Whisper), then chunk and embed alongside the open-access literature. Feeds the enrichment step below with conceptual context MP's structured data doesn't carry (why a material is used somewhere, not just what its properties are). |
| **Storage** | Neo4j — reuses your existing certification. Schema designed *before* bulk loading, not reverse-engineered after. |
| **Enrichment** | Small RAG pipeline (embeddings + retrieval over open-access abstracts, plus your parsed books/video transcripts) proposing candidate `USED_IN` tags and supporting context. Human-reviewed before being committed to the graph — assistive, not autonomous. |
| **Query layer** | LangGraph agent: NL question → Cypher → answer. Reuses your current stack rather than introducing new frameworks, so your hours go into the materials domain, not tool-learning overhead. |
| **Language** | Python throughout. Notebooks/scripts through Phase 3–4; no deployment infrastructure needed for v1. |

---

## When (Phased timeline, ~4h/week)

| Phase | What | Est. time |
|---|---|---|
| 1 | Get Materials Project API access; pull and explore first dataset across the three domains | ~2 weeks |
| 2 | Design schema/ontology: finalize node types, relationships, review against real data from Phase 1 | ~2 weeks |
| 3 | Load into Neo4j; write and validate Cypher queries against real questions | ~2 weeks |
| 4 | Build RAG enrichment step: literature abstracts + parsed books/video transcripts → `USED_IN`/application tagging | ~3–4 weeks |
| 5 | NL-to-Cypher query layer (LangGraph) | ~2–3 weeks |

**Total: ~11–13 weeks (about 3 months) to a demoable v1 at under 5h/week.**

**Checkpoint after Phase 3:** a real, correctly-modeled graph you can query is already "something to be proud of," independent of whether Phases 4–5 happen on schedule. Don't treat it as a failure if the project pauses there for a while.

---

## Success criteria for v1

- Graph populated with real Materials Project data across all three domains, modeled with real relationships — not a flat property dump.
- Can answer 5–10 genuinely interesting cross-domain questions via Cypher (e.g., *which stable, non-toxic materials have both high ionic conductivity and low-cost constituent elements?*).
- RAG enrichment step visibly adds tags Materials Project doesn't natively provide, with some review/confidence step — not blindly trusted output.
- You can explain and defend every schema decision — *why this relationship, why this node type*. That defensibility is the actual skill being built, more than the final dataset size.

---

## Risks & constraints to keep in view

- **Time is the binding constraint.** Protect the Phase 3 checkpoint above everything else. If hours shrink further, cut to one domain instead of three — don't cut corners on schema quality.
- **Data is computed, not always measured.** Materials Project properties are largely DFT-computed. If you ever present results externally, distinguish predicted vs. experimentally validated.
- **IP boundary on formulation chemistry is firm** — schema only, no proprietary data, until you have a legitimate source (public literature or a future employer's own data with clearance).
- **Personal library stays personal.** Parsed books/video transcripts are fine to embed for your own retrieval use, but if this project ever goes public, don't redistribute the source text/transcripts (or large verbatim chunks) alongside the code — same boundary as formulation chemistry above, different reason (copyright, not confidentiality).
- **Book/video ingestion adds real engineering, not just data volume.** OCR on scanned PDFs and video transcription are fiddlier than pulling structured data from an API — budget for this explicitly rather than assuming it's "the same as Phase 1."
- **Scope creep is the main failure mode.** The original six-piece vision (full app, deployment, branding) stays parked. Revisit only after the Phase 3 checkpoint, and only if you want to.

---

## Full roadmap beyond v1 (Phases 6–9, exploratory)

None of this is committed. It exists so you can see the whole shape of the idea — not as a signal that you should start Phase 6 the week Phase 5 ends.

### Phase 6 — Predictive ML layer (~3–4 weeks)
- **What:** Train models to predict properties for compositions not in Materials Project, or to score likely applications — gradient boosting / random forest via scikit-learn to start, using composition/structure descriptors (e.g. via `matminer`).
- **How:** Materials Project data as the labeled set; a proper train/validation split; a couple of honest baselines before anything fancier. A GNN is a stretch goal, not a requirement.
- **Why:** the one piece of the whole roadmap that's traditional numerical ML rather than LLM/agent work — genuinely different from your day-to-day GraphRAG.

### Phase 7 — MCP tool exposure (~2–3 weeks)
- **What:** Wrap the graph queries (and Phase 6 predictions, if built) as an MCP server other agents can call — e.g. `query_materials_graph()`, `predict_property()`, `get_similar_materials()`.
- **How:** Python MCP SDK; test it as a tool from Claude Code or Claude Desktop.
- **Why:** this is the actual "not just a wrapper" differentiator flagged earlier — turns the project into infrastructure an LLM can use, instead of another chat UI competing with one.

### Phase 8 — Front-end (~3–4 weeks)
- **What:** A demo surface for someone other than you. Worth reconsidering Django+HTMX from the original plan here — Streamlit or Gradio (Python-only) gets a presentable UI in a fraction of the time, and matches your existing stack better than a new backend framework would.
- **How:** Wrap the NL query layer and graph explorer view in Streamlit/Gradio; read-only, single-user is enough.
- **Why:** only worth doing if you want to show this to someone who isn't you — not a prerequisite for the project to be "done."

### Phase 9 — Deployment (~1–2 weeks)
- **What:** Containerize with Docker; deploy to a low-maintenance host (Render/Fly.io/Railway rather than a self-managed VPS+Nginx setup); basic CI via GitHub Actions.
- **How:** Docker Compose for local/prod parity; CI runs tests, then builds and pushes the image.
- **Why:** proof of end-to-end shipping ability. Reuses Docker, which is already on your CV — the least new material in the whole roadmap.

**Cumulative total if you build all of it:** roughly 20–26 weeks (5–6 months) on top of v1's ~11–13 weeks — call it the better part of a year, realistically, given how side projects actually go. That's not a reason to skip having the map. It's a reason to keep treating v1 as the real commitment and everything past it as "we'll see."
