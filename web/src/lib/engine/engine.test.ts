import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { formulaRuns, fmtConditions, fmtNumber, fmtRange } from '../format';
import { parseHash } from '../router';
import { indexSnapshot, materialsWithAll } from '../snapshot';
import type { Snapshot } from '../types';
import { analyse } from './composition';
import { applicationCoverage, elementFog } from './coverage';
import { resolveMaterial, searchMaterials } from './resolve';
import { screen } from './screening';

const SNAP = JSON.parse(readFileSync(new URL('../../../public/data/snapshot.json', import.meta.url), 'utf8')) as Snapshot;
const SCHEMA = JSON.parse(readFileSync(new URL('../../data/snapshot.schema.json', import.meta.url), 'utf8'));
const a = indexSnapshot(SNAP);

describe('snapshot', () => {
  it('validates against the JSON Schema generated from the pydantic models', () => {
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(SCHEMA);
    const ok = validate(SNAP);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
  it('is labelled as a sample and cites only the illustrative source', () => {
    expect(SNAP.meta.sample).toBe(true);
    for (const m of SNAP.materials) for (const p of m.properties) expect(p.source_id).toBe('sample:illustrative');
  });
  it('indexes materials by element', () => {
    expect(materialsWithAll(a, ['Li', 'Co']).map((m) => m.key)).toContain('sample:LiCoO2');
    expect(materialsWithAll(a, ['Li', 'Co', 'S'])).toEqual([]);
  });
});

describe('screening (mirror of tools.screen_materials)', () => {
  it('cobalt-free cathodes above 150 mAh/g, ranked by capacity', () => {
    const rows = screen(a, { application: 'Li-ion cathode', exclude_elements: ['Co'], constraints: [{ property_type: 'specific_capacity', min: 150 }], max_energy_above_hull: null, kind: 'any' });
    const keys = rows.map((r) => r.material_key);
    expect(keys).toContain('sample:LiFePO4');
    expect(keys).not.toContain('sample:LiNi0.8Mn0.1Co0.1O2');
    const caps = rows.map((r) => r.properties[0].value as number);
    expect([...caps].sort((x, y) => y - x)).toEqual(caps);
  });
  it('stability cap requires an energy-above-hull value', () => {
    const rows = screen(a, { max_energy_above_hull: 0.05, kind: 'crystal' });
    expect(rows.every((r) => r.energy_above_hull !== null && r.energy_above_hull <= 0.05)).toBe(true);
  });
});

describe('composition (mirror of tools.composition_analysis)', () => {
  it('NMC811 is mostly critical elements', () => {
    const r = analyse(a, a.byKey.get('sample:LiNi0.8Mn0.1Co0.1O2')!);
    expect(r.critical_elements.map((e) => e.symbol).sort()).toEqual(['Co', 'Li', 'Mn', 'Ni']);
    expect(r.critical_atom_fraction).toBeGreaterThan(0.4);
  });
  it('finds single-element substitutions', () => {
    const r = analyse(a, a.byKey.get('sample:Li3YCl6')!);
    expect(r.substitutions.map((s) => s.material_key)).toContain('sample:Li3InCl6');
  });
});

describe('coverage and fog', () => {
  it('solid electrolyte conductivity coverage counts confirmed tags only', () => {
    const rows = applicationCoverage(a, 'solid electrolyte');
    const sig = rows.find((r) => r.property_type === 'ionic_conductivity')!;
    expect(sig.total).toBe(SNAP.materials.filter((m) => m.used_in.some((u) => u.application === 'solid electrolyte' && u.confirmed)).length);
    expect(sig.coverage_pct).toBe(100);
  });
  it('fog is null where nothing is charted', () => {
    const fog = elementFog(a, 'ionic_conductivity');
    expect(fog.get('Au')).toBeUndefined();
    expect(fog.get('Ge')!.coverage).toBe(1); // only LGPS contains Ge
    expect(fog.get('S')!.coverage).toBeCloseTo(2 / 3); // LiTFSI and LiFSI carry no conductivity value
  });
});

describe('resolve and search', () => {
  it('resolves acronyms and names through the alias table', () => {
    expect(resolveMaterial(a, 'LLZO')!.key).toBe('sample:Li7La3Zr2O12');
    expect(resolveMaterial(a, 'ethylene carbonate')!.key).toBe('sample:mol:ec');
    expect(resolveMaterial(a, 'unobtainium')).toBeNull();
  });
  it('search ranks exact and prefix matches first', () => {
    expect(searchMaterials(a, 'lfp')[0].key).toBe('sample:LiFePO4');
    expect(searchMaterials(a, 'li3').length).toBeGreaterThan(1);
  });
});

describe('format', () => {
  it('formula subscripts', () => {
    expect(formulaRuns('Li7La3Zr2O12').filter((r) => r.sub).map((r) => r.text)).toEqual(['7', '3', '2', '12']);
    expect(formulaRuns('Na3V2(PO4)3').filter((r) => r.sub).map((r) => r.text)).toEqual(['3', '2', '4', '3']);
  });
  it('numbers', () => {
    expect(fmtNumber(1.2e-2)).toBe('0.012');
    expect(fmtNumber(4e-4)).toBe('4×10⁻⁴');
    expect(fmtNumber(1e-6)).toBe('10⁻⁶');
    expect(fmtNumber(3579)).toBe('3,579');
    expect(fmtNumber(3.45)).toBe('3.45');
    expect(fmtRange(3, 4.6, 'V')).toBe('3–4.6 V');
    expect(fmtRange(1e-4, null, 'S/cm')).toBe('≥ 10⁻⁴ S/cm');
  });
  it('conditions', () => {
    expect(fmtConditions('{"temperature_K": 298}')).toBe('25 °C');
    expect(fmtConditions('{"phase": "tetragonal", "temperature_K": 298}')).toBe('phase: tetragonal · 25 °C');
    expect(fmtConditions('')).toBe('');
  });
});

describe('router', () => {
  it('parses routes and params', () => {
    expect(parseHash('#/').name).toBe('atlas');
    expect(parseHash('#/?el=Li,Co').query.get('el')).toBe('Li,Co');
    const m = parseHash('#/m/sample%3ANa3V2(PO4)3');
    expect(m.name).toBe('material');
    expect(m.params.key).toBe('sample:Na3V2(PO4)3');
    const q = parseHash('#/q/solid%20electrolyte?m=sample%3ALiFePO4');
    expect(q.params.app).toBe('solid electrolyte');
    expect(q.query.get('m')).toBe('sample:LiFePO4');
    expect(parseHash('#/nowhere').name).toBe('notfound');
  });
});
