// Mirror of tools.screen_materials over the static snapshot.
import type { Atlas } from '../snapshot';
import type { Kind, Material, PropertyValue } from '../types';

export interface Constraint { property_type: string; min?: number | null; max?: number | null }
export interface ScreeningParams {
  application?: string | null; include_elements?: string[]; exclude_elements?: string[]; constraints?: Constraint[];
  max_energy_above_hull?: number | null; kind?: Kind | 'any'; order_by?: string | null; limit?: number;
}
export interface ScreenRow { material_key: string; formula: string; kind: Kind; energy_above_hull: number | null; properties: (PropertyValue | { property_type: string; value: null })[] }

const has = (m: Material, sym: string) => m.composition.some((c) => c.symbol === sym);
const valuesOf = (m: Material, prop: string) => m.properties.filter((p) => p.property_type === prop);

export function screen(a: Atlas, p: ScreeningParams): ScreenRow[] {
  const include = p.include_elements ?? [];
  const exclude = p.exclude_elements ?? [];
  const constraints = (p.constraints ?? []).filter((c) => a.props.has(c.property_type));
  const kind = p.kind ?? 'crystal';
  const limit = Math.max(1, Math.min(p.limit ?? 15, 100));
  const out: (ScreenRow & { _rank: number })[] = [];

  for (const m of a.snap.materials) {
    if (kind !== 'any' && m.kind !== kind) continue;
    if (!include.every((s) => has(m, s))) continue;
    if (exclude.some((s) => has(m, s))) continue;
    if (p.application && !m.used_in.some((u) => u.application === p.application)) continue;

    let eah: number | null = null;
    if (p.max_energy_above_hull != null) {
      const ok = valuesOf(m, 'energy_above_hull').filter((v) => v.value <= (p.max_energy_above_hull as number));
      if (!ok.length) continue;
      eah = Math.min(...ok.map((v) => v.value));
    }
    const picked: PropertyValue[] = [];
    let pass = true;
    for (const c of constraints) {
      const ok = valuesOf(m, c.property_type).filter((v) => (c.min == null || v.value >= c.min) && (c.max == null || v.value <= c.max));
      if (!ok.length) { pass = false; break; }
      picked.push(ok[0]);
    }
    if (!pass) continue;
    const orderIdx = constraints.findIndex((c) => c.property_type === p.order_by);
    const rankVal = constraints.length ? picked[orderIdx >= 0 ? orderIdx : 0].value : -(eah ?? 0);
    out.push({ material_key: m.key, formula: m.formula, kind: m.kind, energy_above_hull: eah, properties: picked, _rank: rankVal });
  }
  out.sort((x, y) => (constraints.length ? y._rank - x._rank : (x.energy_above_hull ?? 0) - (y.energy_above_hull ?? 0) || x.formula.localeCompare(y.formula)));
  return out.slice(0, limit).map(({ _rank, ...row }) => row);
}
