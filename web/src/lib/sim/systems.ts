/**
 * Heating and cooling systems: what heats the water (or the air) and what releases the heat in the rooms.
 *
 * Heat pump efficiency follows the Carnot limit scaled by a quality factor, the same rule of thumb as
 * the simple simulator (heating-sim.ts), now evaluated every hour at the actual outdoor and water
 * temperatures:  COP = quality * T_sink / (T_sink - T_source)  (kelvin). Quality factors and heat
 * exchanger approach temperatures are calibrated so that an air-to-water unit gives about COP 4.3 at
 * outdoor 7 degC / water 35 degC and about 2.4 at -7 degC / 55 degC, in the range of current
 * datasheets (editorial calibration, see the challenge page for the physics source).
 *
 * Emitter output follows the standard power law Q = Q_design * (dT / dT_design)^n, with n = 1.3 for
 * radiators (EN 442 practice), 1.1 for underfloor heating and 1.0 for fan coils.
 * All other numbers here are labelled editorial estimates the visitor can see on the page.
 */

export type GeneratorId = 'boiler-old' | 'boiler' | 'hp-air' | 'hp-ground' | 'hybrid' | 'split' | 'electric';
export type EmitterId = 'radiators' | 'radiators-large' | 'underfloor' | 'fancoil';
export type CoolingChoice = 'none' | 'system' | 'split';
export type DhwChoice = 'system' | 'hp-water-heater' | 'electric' | 'gas';

export interface GeneratorInfo {
  id: GeneratorId;
  label: string;
  short: string;
  hydronic: boolean;
  fuel: 'gas' | 'electricity' | 'both';
  /** can it also cool (with suitable emitters)? */
  reversible: boolean;
}

export const GENERATORS: GeneratorInfo[] = [
  { id: 'boiler-old', label: 'Old non-condensing gas boiler', short: 'Old boiler', hydronic: true, fuel: 'gas', reversible: false },
  { id: 'boiler', label: 'Condensing gas boiler', short: 'Gas boiler', hydronic: true, fuel: 'gas', reversible: false },
  { id: 'hp-air', label: 'Air-to-water heat pump', short: 'Air heat pump', hydronic: true, fuel: 'electricity', reversible: true },
  { id: 'hp-ground', label: 'Ground-source heat pump', short: 'Ground heat pump', hydronic: true, fuel: 'electricity', reversible: true },
  { id: 'hybrid', label: 'Hybrid: heat pump + condensing boiler', short: 'Hybrid', hydronic: true, fuel: 'both', reversible: true },
  { id: 'split', label: 'Air-to-air heat pumps (multi-split)', short: 'Splits', hydronic: false, fuel: 'electricity', reversible: true },
  { id: 'electric', label: 'Electric panel heaters', short: 'Electric panels', hydronic: false, fuel: 'electricity', reversible: false },
];

export interface EmitterInfo {
  id: EmitterId;
  label: string;
  /** power-law exponent */
  n: number;
  /** mean water minus room temperature at the design point, K */
  dtDesign: number;
  /** emitter size relative to the room's design heat loss */
  size: number;
  /** supply minus return water temperature, K */
  dtWater: number;
  /** where the heat goes: room air, room surfaces, building mass */
  split: [number, number, number];
  /** cooling capacity per m2 of floor, W (0 = cannot cool) */
  coolWm2: number;
  /** chilled-water supply temperature when cooling, degC */
  coolSupply: number;
  /** cap on heat output per m2 of floor, W (underfloor surface-temperature limit) */
  maxWm2?: number;
}

export const EMITTERS: EmitterInfo[] = [
  { id: 'radiators', label: 'Radiators sized for this home', n: 1.3, dtDesign: 50, size: 1.1, dtWater: 10, split: [0.7, 0.3, 0], coolWm2: 0, coolSupply: 18 },
  { id: 'radiators-large', label: 'Oversized radiators (twice the size)', n: 1.3, dtDesign: 50, size: 2.2, dtWater: 8, split: [0.7, 0.3, 0], coolWm2: 0, coolSupply: 18 },
  { id: 'underfloor', label: 'Underfloor heating', n: 1.1, dtDesign: 15, size: 1.1, dtWater: 5, split: [0.1, 0.4, 0.5], coolWm2: 35, coolSupply: 18, maxWm2: 100 },
  { id: 'fancoil', label: 'Fan coils', n: 1.0, dtDesign: 25, size: 1.3, dtWater: 5, split: [1, 0, 0], coolWm2: 70, coolSupply: 7 },
];

/** Split units and panels heat the room air directly. */
export const AIR_SPLIT: [number, number, number] = [1, 0, 0];
export const PANEL_SPLIT: [number, number, number] = [0.85, 0.15, 0];

export const emitterInfo = (id: EmitterId) => EMITTERS.find((e) => e.id === id) ?? EMITTERS[0];
export const generatorInfo = (id: GeneratorId) => GENERATORS.find((g) => g.id === id) ?? GENERATORS[1];

/** Heat output of an emitter, W, for a mean water temperature `tm` in a room at `tAir`. */
export function emitterOutput(e: EmitterInfo, designLoad: number, area: number, tm: number, tAir: number): number {
  const dt = tm - tAir;
  if (dt <= 0) return 0;
  let q = e.size * designLoad * Math.pow(dt / e.dtDesign, e.n);
  if (e.maxWm2) q = Math.min(q, e.maxWm2 * area);
  return q;
}

/** Mean water temperature an emitter needs to give `q` watts, degC (Infinity if it cannot). */
export function meanWaterFor(e: EmitterInfo, designLoad: number, area: number, q: number, tAir: number): number {
  if (q <= 0) return tAir;
  if (e.maxWm2 && q > e.maxWm2 * area + 1e-6) return Infinity;
  const cap = e.size * designLoad;
  if (cap <= 0) return Infinity;
  return tAir + e.dtDesign * Math.pow(q / cap, 1 / e.n);
}

const K = 273.15;

/** Carnot-scaled COP. */
export function carnotCop(quality: number, tSink: number, tSource: number): number {
  const lift = tSink - tSource;
  if (lift <= 1) return 12;
  return Math.min(12, (quality * (tSink + K)) / lift);
}

export interface HpModel {
  /** heating: quality factor, evaporator approach below the source, condenser approach above the sink */
  quality: number;
  srcApproach: number;
  sinkApproach: number;
  /** cooling quality factor */
  coolQuality: number;
  /** highest water (or air) temperature it can deliver, degC */
  maxSupply: number;
}

/** Editorial calibration, see file header. */
export const HP_AIR: HpModel = { quality: 0.5, srcApproach: 6, sinkApproach: 2, coolQuality: 0.4, maxSupply: 60 };
export const HP_GROUND: HpModel = { quality: 0.55, srcApproach: 3, sinkApproach: 2, coolQuality: 0.45, maxSupply: 60 };
export const HP_SPLIT: HpModel = { quality: 0.5, srcApproach: 6, sinkApproach: 15, coolQuality: 0.37, maxSupply: 45 };

/** Heating COP of an air-source unit: defrost penalty of 10% between -7 and +5 degC in humid air (editorial). */
export function airHpHeatingCop(m: HpModel, tOut: number, rh: number, tSupply: number): number {
  let cop = carnotCop(m.quality, tSupply + m.sinkApproach, tOut - m.srcApproach);
  if (tOut > -7 && tOut < 5 && rh > 75) cop *= 0.9;
  return Math.max(1, cop);
}

/** Cooling EER: heat rejected to outdoor air at tOut + 8 K, evaporating 2 K below the chilled-water supply. */
export function coolingEer(m: HpModel, tOut: number, tColdSide: number): number {
  return Math.max(1, carnotCop(m.coolQuality, tOut + 8, tColdSide - 2) - 1);
}

/**
 * Brine temperature from a ground loop, degC: annual mean air temperature minus 3 K, swinging 3 K
 * with the seasons, coldest in late February (editorial simplification of borehole behaviour).
 */
export function groundBrine(annualMeanAir: number, hourOfYear: number): number {
  const day = hourOfYear / 24;
  return annualMeanAir - 3 - 3 * Math.cos((2 * Math.PI * (day - 55)) / 365);
}

/** Available heat pump output as a share of the rated output (rated at 7 degC outdoor), editorial. */
export function airHpCapacityFactor(tOut: number, tSupply: number): number {
  const f = 1 + 0.022 * (tOut - 7);
  const g = 1 - 0.005 * Math.max(0, tSupply - 35);
  return Math.min(1.25, Math.max(0.4, f)) * g;
}

/** Below 30% of the rated output inverter heat pumps start cycling on and off: up to 10% efficiency loss (editorial). */
export function cyclingFactor(load: number, rated: number): number {
  const min = 0.3 * rated;
  if (load <= 0 || load >= min) return 1;
  return 0.9 + 0.1 * (load / min);
}

/**
 * Condensing boiler efficiency on the lower heating value, as a function of return water temperature:
 * flue gases condense below about 55 degC return, so efficiency rises from 0.96 to about 1.04 at 30 degC
 * (shape from US DOE and NYSERDA condensing-boiler guides; exact values vary by model, editorial).
 */
export function condensingEfficiency(tReturn: number): number {
  if (tReturn <= 30) return 1.04;
  if (tReturn <= 55) return 1.04 - ((tReturn - 30) / 25) * 0.07;
  return 0.96;
}

/** Seasonal efficiency of an old non-condensing boiler (editorial). */
export const OLD_BOILER_EFFICIENCY = 0.82;

/** Hot water: efficiencies of separate heaters (editorial; heat pump water heater per EN 16147 typical values). */
export const DHW_BOILER_EFFICIENCY = 0.9;
export const DHW_HPWH_COP = 2.8;
/** Standing loss of a 200-litre hot-water cylinder, kWh/day (editorial, roughly energy label class B). */
export const TANK_LOSS_KWH_DAY = 1.2;
