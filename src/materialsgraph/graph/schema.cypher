// MaterialsGraph — Neo4j schema (domain-agnostic core, battery-instantiated)
// See docs/technical_buildplan.md Section 2 for full rationale and Section 2.1
// for provenance / confirmation semantics.
//
// Design principle: properties are nodes, not fields on Material.
//   (Material)-[:HAS_PROPERTY]->(PropertyValue)-[:OF_TYPE]->(PropertyType)
//   (PropertyValue)-[:SOURCED_FROM]->(Source)
//
// Node labels:
//   Material      material_key (unique, namespaced: mp:<id> | oqmd:<id> | lit:<reduced_formula>[|<spacegroup>] | mol:<inchikey>),
//                 mp_id (unique when present), formula, reduced_formula, kind (crystal|molecule),
//                 spacegroup, spacegroup_number, structure_type, smiles, inchikey, common_name,
//                 external_ids, data_source, license, provider, created_at
//   Element       symbol (unique), name, atomic_number, eu_crm_2023, usgs_2022, supply_risk_note
//   Domain        name (unique) -- e.g. "Battery"
//   Application   name (unique), description, aliases -- e.g. "Li-ion cathode", "solid electrolyte"
//   PropertyType  name (unique), unit, description, plausible_min, plausible_max
//   PropertyValue value, unit, property_type, source_id, conditions (JSON string, "" = unspecified),
//                 source_type (measured|dft|mlip_predicted|literature_asserted),
//                 confidence, confirmed (bool), extraction_method, quote, computed_at
//   Source        source_id (unique), title, type (paper|preprint|book|video|database), authors, year,
//                 url_or_doi, doi, abstract, abstract_embedding (384 floats), license, openalex_id,
//                 is_oa, oa_pdf_url, provider, ingested_at
//   Chunk         chunk_id (unique), text, embedding (384 floats), section, page, ordinal, source_id
//                 -- full-text chunks of CC-licensed open-access sources only
//   Gap           gap_id (unique), description, status (open|addressed), application,
//                 extraction_method, confirmed, identified_date
//
// Relationships:
//   (Material)-[:COMPOSED_OF {stoichiometry, fraction}]->(Element)
//   (Material)-[:HAS_PROPERTY]->(PropertyValue)
//   (PropertyValue)-[:OF_TYPE]->(PropertyType)
//   (PropertyValue)-[:SOURCED_FROM]->(Source)
//   (Material)-[:USED_IN {source_id, confirmed: bool, basis (computed|literature|curated), quote, extraction_method}]->(Application)
//   (Application)-[:TAGGED_BY]->(Source)
//   (Application)-[:BELONGS_TO]->(Domain)
//   (Domain)-[:REQUIRES_PROPERTY {target_min, target_max, importance}]->(PropertyType)
//   (Application)-[:REQUIRES_PROPERTY {target_min, target_max, importance}]->(PropertyType)
//   (Material)-[:SIMILAR_TO {method, score, confirmed: bool, computed_at}]->(Material)
//   (Domain)-[:HAS_GAP]->(Gap)
//   (Gap)-[:DOCUMENTED_IN]->(Source)
//   (Chunk)-[:PART_OF]->(Source)
//
// NOTE: ingestion/schema_loader.py runs this file one statement per line.
// Keep every statement on a single line.

// Constraints

CREATE CONSTRAINT material_key IF NOT EXISTS FOR (m:Material) REQUIRE m.material_key IS UNIQUE;
CREATE CONSTRAINT material_mp_id IF NOT EXISTS FOR (m:Material) REQUIRE m.mp_id IS UNIQUE;
CREATE CONSTRAINT element_symbol IF NOT EXISTS FOR (e:Element) REQUIRE e.symbol IS UNIQUE;
CREATE CONSTRAINT domain_name IF NOT EXISTS FOR (d:Domain) REQUIRE d.name IS UNIQUE;
CREATE CONSTRAINT application_name IF NOT EXISTS FOR (a:Application) REQUIRE a.name IS UNIQUE;
CREATE CONSTRAINT proptype_name IF NOT EXISTS FOR (p:PropertyType) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.source_id IS UNIQUE;
CREATE CONSTRAINT gap_id IF NOT EXISTS FOR (g:Gap) REQUIRE g.gap_id IS UNIQUE;
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.chunk_id IS UNIQUE;

// Indexes

CREATE INDEX material_reduced_formula IF NOT EXISTS FOR (m:Material) ON (m.reduced_formula);
CREATE INDEX material_kind IF NOT EXISTS FOR (m:Material) ON (m.kind);
CREATE INDEX material_inchikey IF NOT EXISTS FOR (m:Material) ON (m.inchikey);
CREATE INDEX propvalue_type IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.property_type);
CREATE INDEX propvalue_source_type IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.source_type);
CREATE INDEX propvalue_source_id IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.source_id);
CREATE INDEX propvalue_confirmed IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.confirmed);
CREATE INDEX source_type_idx IF NOT EXISTS FOR (s:Source) ON (s.type);
CREATE INDEX source_year IF NOT EXISTS FOR (s:Source) ON (s.year);
CREATE INDEX source_doi IF NOT EXISTS FOR (s:Source) ON (s.doi);
CREATE INDEX source_openalex IF NOT EXISTS FOR (s:Source) ON (s.openalex_id);
CREATE INDEX chunk_source_id IF NOT EXISTS FOR (c:Chunk) ON (c.source_id);

// Full-text and vector indexes (Neo4j >= 5.15; docker-compose pins 5.26)

CREATE FULLTEXT INDEX source_text IF NOT EXISTS FOR (s:Source) ON EACH [s.title, s.abstract];
CREATE FULLTEXT INDEX chunk_text IF NOT EXISTS FOR (c:Chunk) ON EACH [c.text];
CREATE VECTOR INDEX source_abstract_embedding IF NOT EXISTS FOR (s:Source) ON (s.abstract_embedding) OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: 'cosine'}};
CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS FOR (c:Chunk) ON (c.embedding) OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: 'cosine'}};
