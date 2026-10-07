// Mirrors src/materialsgraph/site/snapshot_models.py (validated against data/snapshot.schema.json in tests).
export type SourceType = 'measured' | 'dft' | 'mlip_predicted' | 'literature_asserted';
export type Importance = 'high' | 'medium' | 'low';
export type Kind = 'crystal' | 'molecule';

export interface Requirement { property_type: string; target_min?: number | null; target_max?: number | null; importance: Importance }
export interface PropertyValue {
  property_type: string; value: number; unit: string; source_type: SourceType; confirmed: boolean;
  source_id: string; conditions: string; extraction_method?: string | null; quote?: string | null; note?: string | null;
}
export interface CompositionEntry { symbol: string; stoichiometry: number; fraction: number }
export interface UsedIn { application: string; basis: 'computed' | 'literature' | 'curated'; confirmed: boolean; source_id: string }
export interface Similar { key: string; method: string; score: number; confirmed: boolean }
export interface Material {
  key: string; formula: string; reduced_formula: string; kind: Kind; common_name?: string | null; spacegroup?: string | null;
  structure_type?: string | null; mp_id?: string | null; smiles?: string | null; inchikey?: string | null; license?: string | null;
  blurb?: string | null; composition: CompositionEntry[]; properties: PropertyValue[]; used_in: UsedIn[]; similar: Similar[];
}
export interface PropertyTypeInfo { name: string; unit: string; description: string; plausible: [number, number]; log_scale: boolean }
export interface Application { name: string; description?: string | null; aliases: string[]; kinds: Kind[]; requires: Requirement[] }
export interface ElementFlags { symbol: string; eu_crm_2023: boolean; usgs_2022: boolean; note?: string | null }
export interface Source { source_id: string; title: string; type: string; year?: number | null; doi?: string | null; url?: string | null; license?: string | null; citable: boolean }
export interface Gap { gap_id: string; description: string; application?: string | null; status: 'open' | 'addressed'; confirmed: boolean; source_id: string }
export interface Snapshot {
  meta: { schema_version: number; generated_at: string; generator: string; git_sha?: string | null; sample: boolean; notice: string; counts: Record<string, number> };
  domain: { name: string; requires: Requirement[] };
  property_types: PropertyTypeInfo[];
  applications: Application[];
  elements: ElementFlags[];
  sources: Source[];
  materials: Material[];
  gaps: Gap[];
  aliases: Record<string, string>;
}
