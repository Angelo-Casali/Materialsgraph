/**
 * Money and CO2 for a simulated scenario.
 *
 * Every price and installation cost here is an EXAMPLE the visitor should replace with their own
 * tariff and quotes: the page says so next to every input. Emission factors are ISPRA's (Italy),
 * shared with the simple simulator (heating-sim.ts). Tax deductions follow the Italian scheme in force
 * for 2026 (50% on the main home, 36% otherwise, refunded over 10 years; see the challenge sources).
 */

import { ENVELOPES, EXPOSURES, HEIGHT, sideLength, type Side, ZONES, zoneArea } from './apartment';
import type { Scenario, SimResult } from './engine';
import { ELECTRICITY_KG_CO2_PER_KWH, GAS_KG_CO2_PER_KWH, GAS_KWH_PER_SMC } from '../challenges/heating-sim';
import { type EmitterId, type GeneratorId, generatorInfo } from './systems';

export interface Money {
  /** euro per kWh of electricity, all charges included */
  electricity: number;
  /** euro per standard cubic metre of gas, all charges included */
  gasSmc: number;
  /** euro per kWh paid for PV electricity sent to the grid */
  exportPrice: number;
  /** fixed gas supply charges per year, saved if the home stops using gas */
  gasFixed: number;
  /** real discount rate for the total cost of ownership */
  discount: number;
  years: number;
  incentive: 'none' | 'deduction50' | 'deduction36' | 'grant';
  /** lump-sum grant, euro (e.g. Conto Termico), used when incentive = 'grant' */
  grant: number;
  /** the old boiler must be replaced anyway: the baseline pays for a new condensing boiler */
  boilerDueAnyway: boolean;
}

export const DEFAULT_MONEY: Money = {
  electricity: 0.28,
  gasSmc: 1.1,
  exportPrice: 0.1,
  gasFixed: 90,
  discount: 0.03,
  years: 15,
  incentive: 'deduction50',
  grant: 0,
  boilerDueAnyway: false,
};

/** Example installed costs in euro, VAT included (editorial; replace with real quotes). */
export const GENERATOR_COST: Record<GeneratorId, (ratedW: number) => number> = {
  'boiler-old': () => 0,
  boiler: () => 3000,
  'hp-air': (w) => 6000 + 0.6 * w,
  'hp-ground': (w) => 9000 + 1.6 * w,
  hybrid: () => 9000,
  split: () => 5500,
  electric: () => 1500,
};
export const EMITTER_COST: Record<EmitterId, number> = { radiators: 2500, 'radiators-large': 4000, underfloor: 9000, fancoil: 4500 };
export const UPGRADE_COST = { wallPerM2: 130, windowPerM2: 750, roofPerM2: 120, floorPerM2: 60, mvhr: 5500, pvPerKwp: 1700, splitAc: 4200 };
export const MAINTENANCE: Record<GeneratorId, number> = { 'boiler-old': 150, boiler: 120, 'hp-air': 150, 'hp-ground': 150, hybrid: 220, split: 100, electric: 0 };
const MVHR_MAINTENANCE = 80;

export interface CapexItem {
  label: string;
  eur: number;
  /** counts for the tax deduction (stand-alone gas boilers no longer do, from 2025) */
  deductible: boolean;
  /** counts for a heat-pump grant such as Conto Termico */
  grantable: boolean;
}

function areas(s: Scenario) {
  const exposed = new Set<Side>(EXPOSURES.find((e) => e.id === s.exposure)?.sides ?? []);
  let wall = 0;
  let win = 0;
  for (const z of ZONES) {
    for (const side of exposed) {
      const len = sideLength(z, side);
      if (!len) continue;
      const w = z.windows.filter((x) => x.side === side).reduce((a, x) => a + x.area, 0);
      win += w;
      wall += len * HEIGHT - w;
    }
  }
  const floor = ZONES.reduce((a, z) => a + zoneArea(z), 0);
  return { wall, win, floor };
}

/** What it costs to go from the baseline home to this scenario (examples). */
export function capexItems(s: Scenario, base: Scenario, r: SimResult, money: Money): CapexItem[] {
  const items: CapexItem[] = [];
  const a = areas(s);
  if (s.generator !== base.generator) {
    const gas = s.generator === 'boiler' || s.generator === 'boiler-old';
    const hp = s.generator === 'hp-air' || s.generator === 'hp-ground' || s.generator === 'hybrid' || s.generator === 'split';
    items.push({ label: `New ${generatorInfo(s.generator).label.toLowerCase()}`, eur: GENERATOR_COST[s.generator](r.design.hpRatedW), deductible: !gas, grantable: hp });
  } else if (money.boilerDueAnyway && (s.generator === 'boiler' || s.generator === 'boiler-old')) {
    items.push({ label: 'Replacement condensing boiler', eur: GENERATOR_COST.boiler(0), deductible: false, grantable: false });
  }
  const add = (label: string, eur: number) => items.push({ label, eur, deductible: true, grantable: false });
  if (s.generator !== 'split' && s.generator !== 'electric' && s.emitter !== base.emitter) add('New emitters', EMITTER_COST[s.emitter]);
  if (s.env.uWall < base.env.uWall - 1e-6) add(`External wall insulation, ${Math.round(a.wall)} m²`, a.wall * UPGRADE_COST.wallPerM2);
  if (s.env.uWindow < base.env.uWindow - 1e-6) add(`New windows, ${Math.round(a.win)} m²`, a.win * UPGRADE_COST.windowPerM2);
  if (s.above === 'roof' && s.env.uRoof < base.env.uRoof - 1e-6) add('Roof insulation', a.floor * UPGRADE_COST.roofPerM2);
  if (s.below !== 'heated' && s.env.uFloor < base.env.uFloor - 1e-6) add('Floor insulation', a.floor * UPGRADE_COST.floorPerM2);
  if (s.ventilation === 'mvhr' && base.ventilation !== 'mvhr') add('Ventilation with heat recovery', UPGRADE_COST.mvhr);
  if (s.pvKwp > base.pvKwp) add(`Solar panels, ${(s.pvKwp - base.pvKwp).toFixed(1)} kWp`, (s.pvKwp - base.pvKwp) * UPGRADE_COST.pvPerKwp);
  if (s.cooling === 'split' && base.cooling !== 'split' && s.generator !== 'split') add('Split air conditioners for summer', UPGRADE_COST.splitAc);
  return items.map((i) => ({ ...i, eur: Math.round(i.eur / 50) * 50 }));
}

export interface Bill {
  electricity: number;
  gas: number;
  gasFixed: number;
  pvCredit: number;
  maintenance: number;
  /** total per year, euro */
  total: number;
  gasSmc: number;
  co2Kg: number;
}

export function annualBill(r: SimResult, money: Money): Bill {
  const t = r.totals;
  const gasSmc = t.gasKWh / GAS_KWH_PER_SMC;
  const electricity = t.elecGridKWh * money.electricity;
  const gas = gasSmc * money.gasSmc;
  const gasFixed = t.gasKWh > 1 ? money.gasFixed : 0;
  const pvCredit = t.pvExportKWh * money.exportPrice + t.pvToBaseKWh * money.electricity;
  const maintenance = MAINTENANCE[r.scenario.generator] + (r.scenario.ventilation === 'mvhr' ? MVHR_MAINTENANCE : 0);
  return {
    electricity,
    gas,
    gasFixed,
    pvCredit,
    maintenance,
    total: electricity + gas + gasFixed + maintenance - pvCredit,
    gasSmc,
    co2Kg: t.elecGridKWh * ELECTRICITY_KG_CO2_PER_KWH + t.gasKWh * GAS_KG_CO2_PER_KWH,
  };
}

export interface Ownership {
  capex: number;
  incentive: number;
  /** present value of the incentive */
  incentivePv: number;
  netCapex: number;
  /** total cost of ownership over the horizon, present value, euro */
  tco: number;
  bill: Bill;
}

export function ownership(items: CapexItem[], r: SimResult, money: Money): Ownership {
  const bill = annualBill(r, money);
  const capex = items.reduce((a, i) => a + i.eur, 0);
  const rate = money.incentive === 'deduction50' ? 0.5 : money.incentive === 'deduction36' ? 0.36 : 0;
  let incentive = 0;
  let incentivePv = 0;
  if (rate > 0) {
    incentive = items.filter((i) => i.deductible).reduce((a, i) => a + i.eur, 0) * rate;
    for (let y = 1; y <= 10; y++) incentivePv += incentive / 10 / Math.pow(1 + money.discount, y);
  } else if (money.incentive === 'grant') {
    incentive = Math.min(money.grant, items.filter((i) => i.grantable).reduce((a, i) => a + i.eur, 0));
    incentivePv = incentive / (1 + money.discount);
  }
  let pvBills = 0;
  for (let y = 1; y <= money.years; y++) pvBills += bill.total / Math.pow(1 + money.discount, y);
  return { capex, incentive, incentivePv, netCapex: capex - incentivePv, tco: capex - incentivePv + pvBills, bill };
}

/** Simple payback in years against the baseline (Infinity if it never pays back). */
export function payback(o: Ownership, base: Ownership): number {
  const saving = base.bill.total - o.bill.total;
  const extra = o.netCapex - base.netCapex;
  if (extra <= 0) return 0;
  if (saving <= 0) return Infinity;
  return extra / saving;
}

export { ENVELOPES };
