import { describe, expect, it } from 'vitest';
import { breakEvenElectricityPrice, DEFAULT_INPUTS, estimateScop, GAS_KG_CO2_PER_KWH, GAS_KWH_PER_SMC, simulate } from './heating-sim';

const byId = (r: ReturnType<typeof simulate>, id: string) => r.find((x) => x.id === id)!;

describe('heating simulator', () => {
  it('derives the gas constants from the ISPRA standard parameters', () => {
    expect(GAS_KWH_PER_SMC).toBeCloseTo(9.849, 3);
    expect(GAS_KG_CO2_PER_KWH).toBeCloseTo(0.2035, 4);
  });

  it('boiler and heat pump deliver the same useful heat', () => {
    const r = simulate({ ...DEFAULT_INPUTS, heatDemandKWh: 10000, boilerEfficiency: 0.9, scop: 4 });
    expect(byId(r, 'boiler').gasSmc * GAS_KWH_PER_SMC * 0.9).toBeCloseTo(10000, 6);
    expect(byId(r, 'heat-pump').electricityKWh * 4).toBeCloseTo(10000, 6);
    expect(byId(r, 'heat-pump').gasSmc).toBe(0);
  });

  it('hybrid matches the pure systems at 0% and 100% heat-pump share', () => {
    const at0 = simulate({ ...DEFAULT_INPUTS, hybridHpShare: 0 });
    const at1 = simulate({ ...DEFAULT_INPUTS, hybridHpShare: 1 });
    expect(byId(at0, 'hybrid').costEur).toBeCloseTo(byId(at0, 'boiler').costEur, 9);
    expect(byId(at1, 'hybrid').co2Kg).toBeCloseTo(byId(at1, 'heat-pump').co2Kg, 9);
  });

  it('heat pump and boiler cost the same at the break-even electricity price', () => {
    const p = breakEvenElectricityPrice(DEFAULT_INPUTS);
    const r = simulate({ ...DEFAULT_INPUTS, electricityPricePerKWh: p });
    expect(byId(r, 'heat-pump').costEur).toBeCloseTo(byId(r, 'boiler').costEur, 6);
  });

  it('with the default inputs the heat pump emits less CO2 than the boiler', () => {
    const r = simulate(DEFAULT_INPUTS);
    expect(byId(r, 'heat-pump').co2Kg).toBeLessThan(byId(r, 'boiler').co2Kg);
  });

  it('never returns NaN or negative values for bad inputs', () => {
    const r = simulate({ ...DEFAULT_INPUTS, heatDemandKWh: -5, scop: 0, boilerEfficiency: Number.NaN, hybridHpShare: 3 });
    for (const s of r) for (const v of [s.costEur, s.co2Kg, s.gasSmc, s.electricityKWh]) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('estimateScop', () => {
  it('is higher for underfloor heating than for radiators', () => {
    expect(estimateScop(35, 7)).toBeGreaterThan(estimateScop(55, 7));
  });

  it('follows the Carnot fraction formula', () => {
    expect(estimateScop(35, 7, 0.45)).toBeCloseTo((0.45 * 308.15) / 28, 6);
  });

  it('is clamped to a plausible range', () => {
    expect(estimateScop(35, 35)).toBe(7);
    expect(estimateScop(80, -30)).toBeGreaterThanOrEqual(1);
  });
});
