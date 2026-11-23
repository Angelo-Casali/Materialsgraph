/**
 * Shareable lab state: place, up to four scenarios and the money settings, packed into the URL.
 * Everything read back from a URL is validated and clamped: a shared link is untrusted input.
 */

import { ABOVE_OPTIONS, BELOW_OPTIONS, ENVELOPES, EXPOSURES, MASS } from './apartment';
import { DEFAULT_MONEY, type Money } from './costs';
import { DEFAULT_SCENARIO, type Scenario } from './engine';
import { EMITTERS, GENERATORS } from './systems';

export type PlaceRef = string | { name: string; lat: number; lon: number; year: number };

export interface LabState {
  place: PlaceRef;
  scenarios: Scenario[];
  money: Money;
}

export const MAX_SCENARIOS = 4;

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string, max = 40) => (typeof v === 'string' ? v.slice(0, max) : d);

export function cleanScenario(x: unknown): Scenario {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const d = DEFAULT_SCENARIO;
  const e = (o.env && typeof o.env === 'object' ? o.env : {}) as Record<string, unknown>;
  return {
    name: str(o.name, d.name),
    envelopeId: pick(o.envelopeId, [...ENVELOPES.map((p) => p.id), 'custom'], d.envelopeId),
    env: {
      uWall: num(e.uWall, 0.1, 3.5, d.env.uWall),
      uRoof: num(e.uRoof, 0.1, 3.5, d.env.uRoof),
      uFloor: num(e.uFloor, 0.1, 3.5, d.env.uFloor),
      uWindow: num(e.uWindow, 0.6, 6, d.env.uWindow),
      gWindow: num(e.gWindow, 0.2, 0.9, d.env.gWindow),
      ach: num(e.ach, 0.05, 3, d.env.ach),
    },
    exposure: pick(o.exposure, EXPOSURES.map((p) => p.id), d.exposure),
    below: pick(o.below, BELOW_OPTIONS.map((p) => p.id), d.below),
    above: pick(o.above, ABOVE_OPTIONS.map((p) => p.id), d.above),
    mass: pick(o.mass, Object.keys(MASS) as (keyof typeof MASS)[], d.mass),
    frontFacing: num(o.frontFacing, 0, 359, d.frontFacing),
    ventilation: pick(o.ventilation, ['natural', 'mvhr'] as const, d.ventilation),
    shutters: bool(o.shutters, d.shutters),
    nightVent: bool(o.nightVent, d.nightVent),
    generator: pick(o.generator, GENERATORS.map((g) => g.id), d.generator),
    emitter: pick(o.emitter, EMITTERS.map((m) => m.id), d.emitter),
    cooling: pick(o.cooling, ['none', 'system', 'split'] as const, d.cooling),
    dhw: pick(o.dhw, ['system', 'hp-water-heater', 'electric', 'gas'] as const, d.dhw),
    hpSize: num(o.hpSize, 0.4, 2, d.hpSize),
    backup: bool(o.backup, d.backup),
    occupants: Math.round(num(o.occupants, 1, 6, d.occupants)),
    heatSet: num(o.heatSet, 16, 24, d.heatSet),
    setback: bool(o.setback, d.setback),
    coolSet: num(o.coolSet, 22, 30, d.coolSet),
    dhwLitres: num(o.dhwLitres, 0, 400, d.dhwLitres),
    pvKwp: num(o.pvKwp, 0, 10, d.pvKwp),
  };
}

export function cleanMoney(x: unknown): Money {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const d = DEFAULT_MONEY;
  return {
    electricity: num(o.electricity, 0, 2, d.electricity),
    gasSmc: num(o.gasSmc, 0, 5, d.gasSmc),
    exportPrice: num(o.exportPrice, 0, 1, d.exportPrice),
    gasFixed: num(o.gasFixed, 0, 1000, d.gasFixed),
    discount: num(o.discount, 0, 0.15, d.discount),
    years: Math.round(num(o.years, 1, 30, d.years)),
    incentive: pick(o.incentive, ['none', 'deduction50', 'deduction36', 'grant'] as const, d.incentive),
    grant: num(o.grant, 0, 50_000, d.grant),
    boilerDueAnyway: bool(o.boilerDueAnyway, d.boilerDueAnyway),
  };
}

function cleanPlace(x: unknown): PlaceRef {
  if (typeof x === 'string' && /^[a-z-]{2,20}$/.test(x)) return x;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    const lat = num(o.lat, -90, 90, NaN);
    const lon = num(o.lon, -180, 180, NaN);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { name: str(o.name, 'Custom place', 60), lat, lon, year: Math.round(num(o.year, 1990, new Date().getFullYear() - 1, 2024)) };
    }
  }
  return 'milano';
}

const toB64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function encodeLab(l: LabState): string {
  return toB64(JSON.stringify({ v: 1, p: l.place, s: l.scenarios.slice(0, MAX_SCENARIOS), m: l.money }));
}

export function decodeLab(code: string): LabState | null {
  try {
    if (code.length > 8000) return null;
    const o = JSON.parse(fromB64(code)) as Record<string, unknown>;
    if (!o || o.v !== 1 || !Array.isArray(o.s) || o.s.length === 0) return null;
    return { place: cleanPlace(o.p), scenarios: o.s.slice(0, MAX_SCENARIOS).map(cleanScenario), money: cleanMoney(o.m) };
  } catch {
    return null;
  }
}
