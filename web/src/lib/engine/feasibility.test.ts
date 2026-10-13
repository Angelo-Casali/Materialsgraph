import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assess, classify, disagree, verdict } from './feasibility';
import { indexSnapshot } from '../snapshot';
import type { Snapshot } from '../types';

// Shared with tests/unit/test_site_and_backend_prep.py: same inputs, same expected outputs as the Python tools.
const CASES = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/feasibility_cases.json', import.meta.url), 'utf8'));
const SNAP = JSON.parse(readFileSync(new URL('../../../public/data/snapshot.json', import.meta.url), 'utf8')) as Snapshot;

describe('parity with Python tools._classify', () => {
  for (const c of CASES.classify) it(c.name, () => expect(classify(c.req, c.values)).toBe(c.expected));
});

describe('parity with Python tools._verdict', () => {
  for (const c of CASES.verdict) it(c.name, () => expect(verdict(c.assessment)).toBe(c.expected));
});

describe('disagree', () => {
  it('log scale needs more than a decade', () => {
    expect(disagree([1e-4, 9e-4], 'ionic_conductivity')).toBe(false);
    expect(disagree([1e-6, 4e-4], 'ionic_conductivity')).toBe(true);
  });
  it('linear uses 25% of the larger magnitude', () => {
    expect(disagree([3.4, 3.45], 'voltage')).toBe(false);
    expect(disagree([3.0, 4.2], 'voltage')).toBe(true);
  });
});

describe('assess over the sample snapshot', () => {
  const a = indexSnapshot(SNAP);
  it('LLZO as a solid electrolyte: conductivity is disputed (tetragonal vs cubic)', () => {
    const f = assess(a, 'sample:Li7La3Zr2O12', 'solid electrolyte')!;
    expect(f.rows.find((r) => r.property_type === 'ionic_conductivity')!.status).toBe('conflicting');
    expect(f.verdict).toMatch(/disagree/);
  });
  it('LGPS meets conductivity but lacks stability data', () => {
    const f = assess(a, 'sample:Li10GeP2S12', 'solid electrolyte')!;
    expect(f.rows.find((r) => r.property_type === 'ionic_conductivity')!.status).toBe('met');
    expect(f.verdict).toMatch(/insufficient/);
  });
  it('LCO misses the 150 mAh/g capacity target', () => {
    const f = assess(a, 'sample:LiCoO2', 'Li-ion cathode')!;
    expect(f.rows.find((r) => r.property_type === 'specific_capacity')!.status).toBe('unmet');
  });
  it('LFP meets the cathode targets it has data for', () => {
    const f = assess(a, 'sample:LiFePO4', 'Li-ion cathode')!;
    expect(f.verdict).toBe('feasible on available data (all high-importance targets met)');
  });
  it('unknown material returns null', () => expect(assess(a, 'nope', 'solid electrolyte')).toBeNull());
});
