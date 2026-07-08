# MaterialsGraph — Full Vision (No Time Constraint)

*Companion to `materialsgraph_project_strategy.md`. That document is the real commitment (v1, under 5h/week). This one answers a different question: "if time weren't the constraint, what's the best possible product here?" Read it as a map, not a plan — nothing in this document is scheduled.*

---

## Reality check before the architecture

Unlimited time doesn't remove every constraint. Two still cap the ceiling:

- **Compute.** Real DFT/MD at scale costs money, not just hours — GPU/CPU time, storage, orchestration infrastructure. More hours/week doesn't buy a supercomputer allocation.
- **Physical validation data.** RARA Factory (the Venice deep-tech spinoff mentioned earlier) synthesizes and characterizes on the order of 100+ materials experimentally per day as its actual competitive moat. CuspAI pairs generative AI with physical lab validation and industrial partnerships. A computational-only project — however good — cannot make or test a physical sample. That's not a flaw in the plan; it's a category difference.

So: the honest framing is **best possible computational research assistant**, not a discovery-to-market pipeline. That's still a genuinely valuable, ambitious thing to build — it's just a different finish line than what CuspAI or RARA Factory are running toward.

It's also worth knowing this isn't unclaimed territory. LLM agents orchestrating DFT/MD workflows via a knowledge graph is an active 2025–2026 research area, with published systems already doing pieces of it: DREAMS (hierarchical multi-agent DFT orchestration — planner + structure-generation, convergence-testing, and HPC-scheduling sub-agents), VASPilot (automating full VASP workflows), El Agente Q (multi-agent quantum chemistry), SciToolAgent (a knowledge graph of scientific tools driving multi-step planning), LLMatDesign and MatLLMSearch (LLM-guided candidate generation evaluated by machine-learned force fields and DFT), and literature-extraction agents pulling structured properties from thousands of full-text articles. That's good news — it's provably buildable and there's real prior art — and a grounding one: you'd be building an excellent personal version of something researchers are actively publishing on, not inventing a new category.

---

## Product concept

**Input:** a plain-language target — *"optoelectronic material for a solar cell, band gap around 1.5 eV," "new high-energy-density battery cathode," "insulation material with low thermal conductivity and low embodied carbon."*

**Output:** ranked candidates with confidence levels, the properties that actually matter for that application, what's missing or uncertain about each candidate, and an option to push the top few into deeper simulation.

**The three example applications deliberately need almost disjoint property sets** — this is a feature of the design problem, not an edge case:

| Application | Properties that matter | Typical open challenges |
|---|---|---|
| Optoelectronic | Band gap (direct vs. indirect), carrier mobility, exciton binding energy, stability under illumination | Defect tolerance, lead-free stable alternatives |
| Battery | Ionic conductivity, voltage, capacity, cycling/thermal stability, element cost & abundance | Solid electrolytes with both high conductivity and non-toxicity |
| Insulation | Thermal conductivity (low), density, fire resistance, moisture resistance, embodied carbon | Non-toxic, recyclable alternatives to current foams |

---

## Layer-by-layer architecture

### Layer 1 — Application → property translation
Turns a natural-language target into a structured profile: which properties matter, target ranges, hard constraints (toxicity, cost, abundance). Requires a **polymorphic schema** — each `Application` node links to its own relevant `Property` types with target ranges, rather than one fixed property set for every material. Get this modeling decision right before anything downstream; it's the hinge the rest of the system turns on.

### Layer 2 — Knowledge graph (extended core)
Same Neo4j foundation as v1, with two additions:
- **Provenance/confidence on every property** — measured, DFT-computed, ML-predicted, or literature-asserted, each with its own known error characteristics.
- **`Gap` / `Challenge` nodes** — first-class representations of recognized open problems per domain, linked to `Application` nodes. Sourced by mining the "outlook" and "challenges" sections of review papers — a structured-extraction task, not original research. Current literature-mining agent systems already do this at scale (one recent pipeline extracted structured properties from ~10,000 full-text articles using multi-agent orchestration with a built-in consistency checker).

### Layer 3 — Candidate retrieval & generation
Two tiers:
1. **Retrieval** — materials already in the graph matching or close to the target profile.
2. **Generation** — novel candidates via combinatorial substitution, screened with **open, pretrained universal machine-learning interatomic potentials** (MACE-MP-0, CHGNet, M3GNet) rather than full DFT for the first pass. These now cover most of the periodic table and approximate DFT-quality energies at a small fraction of the cost — the class of model has moved from research curiosity to standard tooling in the last two years.

**Why not train your own generative model:** that's CuspAI's actual R&D investment (hundreds of millions in funding, a team including AI pioneers). Leveraging existing open foundation models for screening, and putting your engineering effort into the graph + orchestration + interpretation layers, is the realistic path to something excellent rather than something abandoned half-built.

### Layer 4 — Simulation-backed validation (shortlist only)
For the handful of candidates worth a closer look: escalate to real DFT (Quantum ESPRESSO — open-source) or MD (LAMMPS, or ASE + an MLIP), orchestrated by an agent rather than run by hand. Mirrors the current research pattern: a planner agent coordinating domain-specific sub-agents for structure generation, convergence testing, and job scheduling — the same shape as your existing LangGraph work, pointed at a new class of tools (simulation codes instead of APIs). Structuring tool selection itself as a knowledge graph (a "tool graph" the planner queries to decide what to call next) is a documented pattern in this space — and it's your GraphRAG instinct applied one level up, to tools instead of materials.

**Compute reality:** even lightweight DFT jobs need real (rentable) compute. Modest, not zero — a rented GPU/CPU allocation for a handful of jobs is realistic; training a competing foundation model is not.

### Layer 5 — Gap & uncertainty tracking
The least "solved" part elsewhere, and the closest match to what you originally asked for: for a given candidate + application pair, the system surfaces not just "predicted band gap: X" but "confidence: Y, and here's what's never been measured for this material class" — a direct, proactive product of Layer 2's provenance metadata, linked to the domain's `Gap` nodes.

### Layer 6 — Interpretation & insight
Turns raw numeric output (band structure, phonon dispersion, elastic tensor, MD trajectory) into a plain-language research narrative: is this candidate promising, why, what's uncertain, what to check next. This is where your chemistry background is a genuine, hard-to-replicate asset — an LLM can describe a soft phonon mode; knowing that it implies dynamical instability is domain judgment, not retrieval.

---

## Build vs. reuse — don't reinvent the parts that already exist

| Need | Use | Not |
|---|---|---|
| Structured materials data | Materials Project, OQMD | Scraping your own |
| Data wrangling / descriptors | `pymatgen`, `matminer` | Custom parsers from scratch |
| Cheap property/energy screening | MACE-MP-0, CHGNet, M3GNet | Training your own generative model |
| Real DFT (shortlist only) | Quantum ESPRESSO (open-source) | Licensed VASP, unless you already have access |
| Molecular dynamics | LAMMPS, or ASE + MLIP | Writing an MD engine |
| Molecule-level descriptors (organics, electrolytes) | RDKit | Reinventing cheminformatics |
| Graph + orchestration + interpretation | Neo4j + LangGraph + your own schema/agent design | — this is the actual differentiator, build it yourself |

---

## Honest ceiling, even with unlimited time

- **No physical validation.** This stays a hypothesis generator and research assistant — genuinely valuable, but structurally different from what a lab-equipped competitor does. Being clear-eyed about this is a strength, not a limitation to apologize for.
- **You'd be building alongside active research, not ahead of it.** The published systems referenced above (DREAMS, VASPilot, El Agente Q, SciToolAgent, LLMatDesign, MatLLMSearch) come from resourced academic groups, not solo side projects. "Best possible product" realistically means "an excellent personal research co-pilot, built on the same architectural ideas the field is converging on" — not "a CuspAI competitor."

---

## Stage-by-stage build order (unconstrained by hours/week — sequence still matters)

1. **v1, as already planned** — graph, RAG enrichment (literature + personal library), NL-to-Cypher query layer.
2. **Extend the schema** — add `Gap`/`Challenge` nodes and provenance/confidence metadata to every property.
3. **Add the polymorphic application-property layer** — per-domain "what matters here" modeling (Layer 1).
4. **Add MLIP-based screening** — MACE-MP-0/CHGNet for cheap candidate generation beyond pure retrieval (Layer 3).
5. **Add the orchestration agent** — start small: a single DFT workflow (e.g., band structure via Quantum ESPRESSO through ASE) before generalizing to a planner + sub-agent architecture.
6. **Add the interpretation layer** — tie numeric outputs to plain-language research narrative.
7. **Everything from the v1 doc's Phases 6–9** — MCP packaging, front-end, deployment — if you still want a demo surface once the computational core is real.

Each stage is independently useful and demoable on its own — this isn't an all-or-nothing build. Stage 2 alone (gaps + confidence tracking) would already be a distinctive, defensible piece of work even if nothing past it gets built.
