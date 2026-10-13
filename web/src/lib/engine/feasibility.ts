// Mirror of src/materialsgraph/query/tools.py: _disagree, _classify, _verdict, feasibility().
// Parity is enforced by feasibility.test.ts against tests/fixtures/feasibility_cases.json.
import type { Atlas } from '../snapshot';
import type { Importance, PropertyValue, Requirement } from '../types';

export type ReqStatus = 'met' | 'unmet' | 'missing' | 'conflicting';
export interface ValueLike { value: number | null; source_type?: string; confirmed?: boolean }
export interface ReqLike { property_type: string; target_min?: number | null; target_max?: number | null; importance?: Importance | string }

const LOG_SCALE_DEFAULT = new Set(['ionic_conductivity', 'viscosity']);
const RANK: Record<string, number> = { measured: 0, dft: 1, mlip_predicted: 2, literature_asserted: 3 };

export function disagree(values: number[], prop: string, logScale: Set<string> = LOG_SCALE_DEFAULT): boolean {
  if (values.length < 2) return false;
  if (logScale.has(prop)) {
    const logs = values.filter((v) => v > 0).map((v) => Math.log10(v));
    return logs.length > 0 && Math.max(...logs) - Math.min(...logs) > 1.0;
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return hi - lo > 0.25 * Math.max(Math.abs(hi), Math.abs(lo), 1e-9);
}

/** The value a verdict is based on: confirmed first, then measured > dft > mlip > literature (stable). */
export function bestValue<T extends ValueLike>(values: T[]): T {
  return values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const ca = a.v.confirmed ? 0 : 1;
      const cb = b.v.confirmed ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const ra = RANK[a.v.source_type ?? ''] ?? 9;
      const rb = RANK[b.v.source_type ?? ''] ?? 9;
      return ra !== rb ? ra - rb : a.i - b.i;
    })[0].v;
}

export function classify(req: ReqLike, values: ValueLike[], logScale?: Set<string>): ReqStatus {
  if (!values.length) return 'missing';
  const nums = values.map((v) => v.value).filter((v): v is number => v !== null && v !== undefined);
  if (disagree(nums, req.property_type, logScale)) return 'conflicting';
  const v = bestValue(values).value as number;
  if (req.target_min != null && v < req.target_min) return 'unmet';
  if (req.target_max != null && v > req.target_max) return 'unmet';
  return 'met';
}

export const VERDICTS = {
  unmet: 'requirements not met on available data',
  conflicting: 'sources disagree on a key requirement; review before concluding',
  missing: 'insufficient data: key requirement has no value in the graph',
  feasible: 'feasible on available data (all high-importance targets met)',
  none: 'no requirement targets defined for this application',
} as const;

export function verdict(assessment: { importance?: string; status: ReqStatus | string }[]): string {
  const high = assessment.filter((a) => a.importance === 'high');
  if (high.some((a) => a.status === 'unmet')) return VERDICTS.unmet;
  if (high.some((a) => a.status === 'conflicting')) return VERDICTS.conflicting;
  if (high.some((a) => a.status === 'missing')) return VERDICTS.missing;
  if (high.length && high.every((a) => a.status === 'met')) return VERDICTS.feasible;
  return VERDICTS.none;
}

export type VerdictTone = 'good' | 'critical' | 'warning' | 'unknown';
export function verdictTone(v: string): VerdictTone {
  if (v === VERDICTS.feasible) return 'good';
  if (v === VERDICTS.unmet) return 'critical';
  if (v === VERDICTS.conflicting) return 'warning';
  return 'unknown';
}

export interface AssessmentRow extends Requirement { unit: string; level: 'application' | 'domain'; status: ReqStatus; values: PropertyValue[] }
export interface Feasibility { materialKey: string; application: string; rows: AssessmentRow[]; verdict: string; level: 'application' | 'domain' | null }

export function requirementsFor(a: Atlas, application: string): { reqs: Requirement[]; level: 'application' | 'domain' | null } {
  const app = a.apps.get(application);
  if (app && app.requires.length) return { reqs: app.requires, level: 'application' };
  if (a.snap.domain.requires.length) return { reqs: a.snap.domain.requires, level: 'domain' };
  return { reqs: [], level: null };
}

export function assess(a: Atlas, materialKey: string, application: string, opts: { includeUnconfirmed?: boolean } = {}): Feasibility | null {
  const m = a.byKey.get(materialKey);
  if (!m) return null;
  const logScale = new Set([...a.props.values()].filter((p) => p.log_scale).map((p) => p.name));
  const { reqs, level } = requirementsFor(a, application);
  const include = opts.includeUnconfirmed ?? true;
  const rows: AssessmentRow[] = reqs.map((req) => {
    const values = m.properties.filter((p) => p.property_type === req.property_type && (include || p.confirmed));
    return { ...req, unit: a.props.get(req.property_type)?.unit ?? '', level: level ?? 'domain', status: classify(req, values, logScale), values };
  });
  return { materialKey, application, rows, verdict: verdict(rows), level };
}
