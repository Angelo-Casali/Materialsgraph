// Mirror of queries.get_application_coverage / get_property_coverage, plus the per-element fog of war.
import type { Atlas } from '../snapshot';
import { requirementsFor } from './feasibility';

export interface CoverageRow { property_type: string; total: number; with_data: number; missing: number; coverage_pct: number }

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);

export function applicationCoverage(a: Atlas, application: string): CoverageRow[] {
  const { reqs } = requirementsFor(a, application);
  const mats = a.snap.materials.filter((m) => m.used_in.some((u) => u.application === application && u.confirmed));
  return reqs.map((r) => {
    const withData = mats.filter((m) => m.properties.some((p) => p.property_type === r.property_type)).length;
    return { property_type: r.property_type, total: mats.length, with_data: withData, missing: mats.length - withData, coverage_pct: pct(withData, mats.length) };
  });
}

export function domainCoverage(a: Atlas): CoverageRow[] {
  const mats = a.snap.materials.filter((m) => m.used_in.some((u) => u.confirmed));
  return a.snap.domain.requires.map((r) => {
    const withData = mats.filter((m) => m.properties.some((p) => p.property_type === r.property_type)).length;
    return { property_type: r.property_type, total: mats.length, with_data: withData, missing: mats.length - withData, coverage_pct: pct(withData, mats.length) };
  });
}

/** For each element: share of materials containing it that have at least one value of `property`. null = no materials (uncharted). */
export function elementFog(a: Atlas, property: string): Map<string, { coverage: number | null; total: number; with_data: number }> {
  const out = new Map<string, { coverage: number | null; total: number; with_data: number }>();
  for (const [sym, mats] of a.byElement) {
    const withData = mats.filter((m) => m.properties.some((p) => p.property_type === property)).length;
    out.set(sym, { coverage: mats.length ? withData / mats.length : null, total: mats.length, with_data: withData });
  }
  return out;
}
