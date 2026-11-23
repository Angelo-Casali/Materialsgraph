import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENVELOPES, FLOOR_AREA } from './apartment';
import { type Climate, climateFromOpenMeteo, climateFromPreset, designTemperature, HOURS } from './climate';
import { annualBill, capexItems, DEFAULT_MONEY, ownership, payback } from './costs';
import { DEFAULT_SCENARIO, internalGains, type Scenario, seasonalCop, simulate } from './engine';
import { decodeLab, encodeLab } from './scenario';
import { sunPosition, surfaceIrradiance } from './solar';
import { airHpHeatingCop, condensingEfficiency, EMITTERS, emitterOutput, HP_AIR, meanWaterFor } from './systems';

const milano = climateFromPreset(JSON.parse(readFileSync('public/data/climate/milano.json', 'utf8')));
const palermo = climateFromPreset(JSON.parse(readFileSync('public/data/climate/palermo.json', 'utf8')));
const env = (id: string) => ENVELOPES.find((e) => e.id === id)!;
const sc = (over: Partial<Scenario>): Scenario => ({ ...DEFAULT_SCENARIO, ...over });

function constantClimate(t: number): Climate {
  const z = () => new Float32Array(HOURS);
  return { id: 'const', name: 'constant', lat: 45, lon: 9, tz: 1, kind: 'tmy', source: 'pvgis-tmy', solarOffsetH: 0, t: new Float32Array(HOURS).fill(t), rh: z().fill(50), ghi: z(), dni: z(), dhi: z(), ws: z() };
}

describe('solar geometry', () => {
  it('puts the sun high in the south at midsummer solar noon in Milan', () => {
    // 21 June, ~12:20 UTC is solar noon at 9.19 E
    const p = sunPosition(171 * 24 + 11.4, 45.46, 9.19);
    expect(Math.acos(p.cosZenith) * (180 / Math.PI)).toBeCloseTo(45.46 - 23.44, 0);
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(5);
  });
  it('gives a south wall more winter sun than a north wall', () => {
    const p = sunPosition(355 * 24 + 11.4, 45.46, 9.19);
    expect(surfaceIrradiance(p, 700, 80, 300, 90, 180)).toBeGreaterThan(surfaceIrradiance(p, 700, 80, 300, 90, 0) * 4);
  });
});

describe('climate', () => {
  it('loads a full typical year with plausible Milan temperatures', () => {
    expect(milano.t.length).toBe(HOURS);
    expect(designTemperature(milano)).toBeLessThan(0);
    expect(designTemperature(palermo)).toBeGreaterThan(designTemperature(milano));
  });
  it('drops 29 February and converts wind from km/h when reading Open-Meteo', () => {
    const time: string[] = [];
    const start = Date.UTC(2024, 0, 1);
    for (let i = 0; i < 8784; i++) time.push(new Date(start + i * 3600e3).toISOString().slice(0, 16));
    const v = (x: number) => time.map(() => x);
    const c = climateFromOpenMeteo(
      { utc_offset_seconds: 0, hourly: { time, temperature_2m: v(10), relative_humidity_2m: v(60), shortwave_radiation: v(0), direct_normal_irradiance: v(0), diffuse_radiation: v(0), wind_speed_10m: v(36) } },
      { name: 'Test', lat: 45, lon: 9 },
      2024,
    );
    expect(c.t.length).toBe(HOURS);
    expect(c.ws[0]).toBeCloseTo(10, 5);
  });
});

describe('emitters and generators', () => {
  it('inverts the emitter power law', () => {
    for (const e of EMITTERS) {
      const tm = meanWaterFor(e, 1000, 20, 600, 20);
      expect(emitterOutput(e, 1000, 20, tm, 20)).toBeCloseTo(600, 3);
    }
  });
  it('matches the calibration points of an air-to-water heat pump', () => {
    expect(airHpHeatingCop(HP_AIR, 7, 60, 35)).toBeGreaterThan(4);
    expect(airHpHeatingCop(HP_AIR, 7, 60, 35)).toBeLessThan(4.8);
    expect(airHpHeatingCop(HP_AIR, -7, 60, 55)).toBeGreaterThan(2);
    expect(airHpHeatingCop(HP_AIR, -7, 60, 55)).toBeLessThan(2.8);
  });
  it('makes a condensing boiler more efficient with cooler return water', () => {
    expect(condensingEfficiency(30)).toBeGreaterThan(condensingEfficiency(50));
    expect(condensingEfficiency(65)).toBeLessThan(1);
  });
});

describe('hourly building model', () => {
  it('closes the energy balance and stays just under H * dT in steady state', () => {
    const c = constantClimate(0);
    const s = sc({ setback: false, generator: 'electric', below: 'ground', above: 'roof', exposure: 'four', occupants: 0 });
    const r = simulate(s, c);
    const b = r.balance;
    const losses = b.windows + b.walls + b.roof + b.floor + b.ventilation;
    // heat in = heat out once the walls have warmed up
    expect(Math.abs(b.heating + b.internal + b.solar - losses) / losses).toBeLessThan(0.005);
    // windows and walls see the (slightly cooler) surface and mass nodes, not the 20 degC air node
    let gains = 0;
    for (let h = 0; h < HOURS; h++) gains += internalGains((h + 1) % 24, 0);
    const upper = (r.design.lossCoefficient * 20 * HOURS - gains) / 1000;
    expect(r.totals.spaceHeatKWh).toBeLessThan(upper * 1.02);
    expect(r.totals.spaceHeatKWh).toBeGreaterThan(upper * 0.8);
  });
  it('holds the set-point with an adequate system and logs few cold hours', () => {
    const r = simulate(sc({ generator: 'boiler' }), milano);
    expect(r.comfort.coldHours).toBeLessThan(300);
    expect(r.totals.spaceHeatKWh / FLOOR_AREA).toBeGreaterThan(15);
    expect(r.totals.spaceHeatKWh / FLOOR_AREA).toBeLessThan(120);
  });
  it('needs less heat as insulation improves', () => {
    const order = ['pre1976', '1976', '1991', '2006', 'deep'].map((id) => simulate(sc({ envelopeId: id, env: env(id) }), milano).totals.spaceHeatKWh);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThan(order[i - 1]);
  });
  it('needs more heat on a top floor and in Milan than mid-block and in Palermo', () => {
    const mid = simulate(sc({}), milano).totals.spaceHeatKWh;
    expect(simulate(sc({ above: 'roof' }), milano).totals.spaceHeatKWh).toBeGreaterThan(mid);
    expect(simulate(sc({}), palermo).totals.spaceHeatKWh).toBeLessThan(mid * 0.6);
  });
  it('gives a heat pump a better seasonal COP with underfloor heating than with small radiators', () => {
    const rad = simulate(sc({ generator: 'hp-air', emitter: 'radiators' }), milano);
    const ufh = simulate(sc({ generator: 'hp-air', emitter: 'underfloor' }), milano);
    expect(seasonalCop(ufh)).toBeGreaterThan(seasonalCop(rad));
    expect(seasonalCop(rad)).toBeGreaterThan(2);
  });
  it('warns when the radiators need hotter water than the heat pump can make', () => {
    const r = simulate(sc({ generator: 'hp-air', emitter: 'radiators', envelopeId: 'pre1976', env: env('pre1976') }), milano);
    expect(r.warnings.join(' ')).toMatch(/water/);
  });
  it('cools with splits and keeps rooms near the cooling set-point', () => {
    const r = simulate(sc({ generator: 'split', cooling: 'system' }), palermo);
    expect(r.totals.coolKWh).toBeGreaterThan(200);
    expect(r.comfort.perZone.living.maxOp).toBeLessThan(28.5);
    const none = simulate(sc({ generator: 'boiler', cooling: 'none' }), palermo);
    expect(none.comfort.hotHours).toBeGreaterThan(r.comfort.hotHours);
  });
  it('stays numerically stable: no room swings more than 6 K in one hour', () => {
    const r = simulate(sc({ generator: 'hp-ground', emitter: 'underfloor', envelopeId: 'deep', env: env('deep') }), milano);
    for (const z of Object.values(r.zones)) {
      for (let h = 1; h < HOURS; h++) expect(Math.abs(z.air[h] - z.air[h - 1])).toBeLessThan(6);
    }
  });
});

describe('money', () => {
  const base = simulate(sc({}), milano);
  const hp = simulate(sc({ name: 'heat pump', generator: 'hp-air', emitter: 'radiators-large' }), milano);
  it('charges the fixed gas fee only while gas is used', () => {
    expect(annualBill(base, DEFAULT_MONEY).gasFixed).toBeGreaterThan(0);
    expect(annualBill(hp, DEFAULT_MONEY).gasFixed).toBe(0);
  });
  it('excludes a stand-alone gas boiler from the tax deduction', () => {
    const items = capexItems(sc({ generator: 'boiler' }), sc({ generator: 'boiler-old' }), base, DEFAULT_MONEY);
    expect(items[0].deductible).toBe(false);
    expect(ownership(items, base, DEFAULT_MONEY).incentive).toBe(0);
  });
  it('computes a payback against the baseline', () => {
    const o0 = ownership([], base, DEFAULT_MONEY);
    const o1 = ownership(capexItems(hp.scenario, base.scenario, hp, DEFAULT_MONEY), hp, DEFAULT_MONEY);
    expect(o1.capex).toBeGreaterThan(5000);
    expect(payback(o1, o0)).toBeGreaterThan(0);
  });
});

describe('shareable scenarios', () => {
  it('round-trips through the URL', () => {
    const lab = { place: 'milano', scenarios: [sc({}), sc({ name: 'Heat pump', generator: 'hp-air', pvKwp: 3 })], money: DEFAULT_MONEY };
    const back = decodeLab(encodeLab(lab));
    expect(back?.scenarios[1].generator).toBe('hp-air');
    expect(back?.scenarios[1].pvKwp).toBe(3);
    expect(back?.place).toBe('milano');
  });
  it('rejects garbage', () => {
    expect(decodeLab('not-base64!!')).toBeNull();
  });
});
