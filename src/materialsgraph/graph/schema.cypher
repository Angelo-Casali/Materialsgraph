// MaterialsGraph — Neo4j schema (domain-agnostic core, battery-instantiated)
// See docs/technical_buildplan.md Section 2 for full rationale.
//
// Design principle: properties are nodes, not fields on Material.
//   (Material)-[:HAS_PROPERTY]->(PropertyValue)-[:OF_TYPE]->(PropertyType)
//   (PropertyValue)-[:SOURCED_FROM]->(Source)
//
// Node labels:
//   Material     mp_id (unique), formula, structure_type, created_at
//   Element      symbol (unique), name, atomic_number
//   Domain       name (unique) -- e.g. "Battery"
//   Application  name (unique) -- e.g. "Li-ion cathode", "solid electrolyte"
//   PropertyType name (unique), unit, description -- e.g. "ionic_conductivity" (S/cm)
//   PropertyValue value, unit, source_type (measured|dft|mlip_predicted|literature_asserted),
//                confidence, computed_at
//   Source       source_id (unique), title, type (paper|book|video), authors, year,
//                url_or_doi, ingested_at
//   Gap          gap_id (unique), description, identified_date
//
// Relationships:
//   (Material)-[:COMPOSED_OF {stoichiometry}]->(Element)
//   (Material)-[:HAS_PROPERTY]->(PropertyValue)
//   (PropertyValue)-[:OF_TYPE]->(PropertyType)
//   (PropertyValue)-[:SOURCED_FROM]->(Source)
//   (Material)-[:USED_IN {confirmed: bool}]->(Application)
//   (Application)-[:TAGGED_BY]->(Source)
//   (Application)-[:BELONGS_TO]->(Domain)
//   (Domain)-[:REQUIRES_PROPERTY {target_min, target_max, importance}]->(PropertyType)
//   (Material)-[:SIMILAR_TO {method, score, confirmed: bool}]->(Material)
//   (Domain)-[:HAS_GAP]->(Gap)
//   (Gap)-[:DOCUMENTED_IN]->(Source)

// Constraints

CREATE CONSTRAINT material_mp_id IF NOT EXISTS FOR (m:Material) REQUIRE m.mp_id IS UNIQUE;
CREATE CONSTRAINT element_symbol IF NOT EXISTS FOR (e:Element) REQUIRE e.symbol IS UNIQUE;
CREATE CONSTRAINT domain_name IF NOT EXISTS FOR (d:Domain) REQUIRE d.name IS UNIQUE;
CREATE CONSTRAINT application_name IF NOT EXISTS FOR (a:Application) REQUIRE a.name IS UNIQUE;
CREATE CONSTRAINT proptype_name IF NOT EXISTS FOR (p:PropertyType) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.source_id IS UNIQUE;
CREATE CONSTRAINT gap_id IF NOT EXISTS FOR (g:Gap) REQUIRE g.gap_id IS UNIQUE;

// Indexes

CREATE INDEX propvalue_type IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.property_type);
CREATE INDEX propvalue_source_type IF NOT EXISTS FOR (pv:PropertyValue) ON (pv.source_type);
CREATE INDEX source_type_idx IF NOT EXISTS FOR (s:Source) ON (s.type);
CREATE INDEX source_year IF NOT EXISTS FOR (s:Source) ON (s.year);
