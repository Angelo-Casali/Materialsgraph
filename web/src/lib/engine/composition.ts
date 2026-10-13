// Mirror of tools.composition_analysis over the static snapshot.
import type { Atlas } from '../snapshot';
import type { CompositionEntry, Material } from '../types';

export interface ElementRow extends CompositionEntry { eu_crm_2023: boolean; usgs_2022: boolean; note?: string | null }
export interface Substitution { material_key: string; formula: string; substituted_in: string; substituted_out: string }
export interface CompositionResult { elements: ElementRow[]; critical_elements: ElementRow[]; critical_atom_fraction: number; substitutions: Substitution[] }

export function analyse(a: Atlas, m: Material): CompositionResult {
  const elements: ElementRow[] = m.composition.map((c) => {
    const f = a.flags.get(c.symbol);
    return { ...c, eu_crm_2023: !!f?.eu_crm_2023, usgs_2022: !!f?.usgs_2022, note: f?.note };
  });
  const total = elements.reduce((s, e) => s + e.fraction, 0) || 1;
  const critical = elements.filter((e) => e.eu_crm_2023 || e.usgs_2022);
  const critical_atom_fraction = Math.round((critical.reduce((s, e) => s + e.fraction, 0) / total) * 1000) / 1000;

  const substitutions: Substitution[] = [];
  if (m.kind === 'crystal' && elements.length >= 2) {
    const syms = new Set(elements.map((e) => e.symbol));
    for (const o of a.snap.materials) {
      if (o.key === m.key || o.kind !== 'crystal') continue;
      const os = new Set(o.composition.map((c) => c.symbol));
      if (os.size !== syms.size) continue;
      const inn = [...os].filter((s) => !syms.has(s));
      const out = [...syms].filter((s) => !os.has(s));
      if (inn.length === 1 && out.length === 1) substitutions.push({ material_key: o.key, formula: o.formula, substituted_in: inn[0], substituted_out: out[0] });
    }
  }
  return { elements, critical_elements: critical, critical_atom_fraction, substitutions: substitutions.slice(0, 15) };
}
