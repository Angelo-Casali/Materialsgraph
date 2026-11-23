/**
 * Hourly whole-year simulation of the apartment: rooms, heating/cooling system, hot water and PV.
 *
 * Each room is a 5-resistance, 1-capacitance network (the "simple hourly method" of EN ISO 13790,
 * carried into EN ISO 52016-1): an air node, a surface node (which stands for the mean radiant
 * temperature) and a mass node that stores heat in walls and floors. Rooms exchange heat through the
 * partitions and open doors. Every hour the controller works out the heat each room needs to hold its
 * set-point, the emitters and the generator decide how much of it they can deliver and at what water
 * temperature, and the room temperatures follow.
 *
 * This is a reduced-order model, the same family used for energy certificates. It is not
 * computational fluid dynamics: air movement in the 3D view is drawn from these results, not solved.
 */

import {
  B_UNHEATED,
  DOORS,
  type Above,
  type Below,
  type Envelope,
  type Exposure,
  EXPOSURES,
  HEIGHT,
  MASS,
  type MassClass,
  sharedLength,
  sideAzimuth,
  sideLength,
  type Side,
  U_PARTITION,
  ZONES,
  type ZoneId,
  zoneArea,
} from './apartment';
import { annualMean, type Climate, designTemperature, HOURS } from './climate';
import { sunPosition, surfaceIrradiance } from './solar';
import {
  AIR_SPLIT,
  airHpCapacityFactor,
  airHpHeatingCop,
  carnotCop,
  condensingEfficiency,
  type CoolingChoice,
  coolingEer,
  cyclingFactor,
  DHW_BOILER_EFFICIENCY,
  DHW_HPWH_COP,
  type DhwChoice,
  type EmitterId,
  emitterInfo,
  emitterOutput,
  type GeneratorId,
  generatorInfo,
  groundBrine,
  HP_AIR,
  HP_GROUND,
  HP_SPLIT,
  meanWaterFor,
  OLD_BOILER_EFFICIENCY,
  PANEL_SPLIT,
  TANK_LOSS_KWH_DAY,
} from './systems';

export interface Scenario {
  name: string;
  envelopeId: string;
  env: Envelope;
  exposure: Exposure;
  below: Below;
  above: Above;
  mass: MassClass;
  /** compass direction the front (living-room) facade faces, degrees clockwise from north */
  frontFacing: number;
  ventilation: 'natural' | 'mvhr';
  shutters: boolean;
  nightVent: boolean;
  generator: GeneratorId;
  emitter: EmitterId;
  cooling: CoolingChoice;
  dhw: DhwChoice;
  /** heat pump size relative to the design heat loss */
  hpSize: number;
  /** electric back-up heater inside the heat pump */
  backup: boolean;
  occupants: number;
  heatSet: number;
  setback: boolean;
  coolSet: number;
  /** hot water drawn per day, litres at 40 degC */
  dhwLitres: number;
  pvKwp: number;
}

export const DEFAULT_SCENARIO: Scenario = {
  name: 'My home today',
  envelopeId: '1976',
  env: { uWall: 0.78, uRoof: 1.01, uFloor: 0.98, uWindow: 2.8, gWindow: 0.75, ach: 0.5 },
  exposure: 'three',
  below: 'heated',
  above: 'heated',
  mass: 'heavy',
  frontFacing: 180,
  ventilation: 'natural',
  shutters: true,
  nightVent: true,
  generator: 'boiler',
  emitter: 'radiators',
  cooling: 'none',
  dhw: 'system',
  hpSize: 1,
  backup: true,
  occupants: 3,
  heatSet: 20,
  setback: true,
  coolSet: 26,
  dhwLitres: 150,
  pvKwp: 0,
};

/** Prices only steer the hybrid's hourly choice between heat pump and boiler. */
export interface ControlPrices {
  electricity: number;
  gasPerKWh: number;
}

export interface ZoneSeries {
  air: Float32Array;
  op: Float32Array;
  surf: Float32Array;
  /** heat delivered by the emitter, W (negative when cooling) */
  q: Float32Array;
  /** heat lost through windows / opaque envelope / ventilation, W */
  lossWin: Float32Array;
  lossOpaque: Float32Array;
  lossVent: Float32Array;
}

export interface Totals {
  spaceHeatKWh: number;
  coolKWh: number;
  dhwKWh: number;
  elecKWh: number;
  elecGridKWh: number;
  gasKWh: number;
  backupKWh: number;
  auxKWh: number;
  pvKWh: number;
  pvToHvacKWh: number;
  pvToBaseKWh: number;
  pvExportKWh: number;
  /** heat (space + water) a heat pump delivered and the electricity it used */
  hpHeatKWh: number;
  hpElecKWh: number;
  boilerHeatKWh: number;
  unmetKWh: number;
  /** cooling electricity */
  coolElecKWh: number;
}

export interface Comfort {
  /** hours someone is in a room colder than the set-point minus 1.5 K, summed over rooms */
  coldHours: number;
  /** hours someone is in a room above the comfort limit, summed over rooms */
  hotHours: number;
  perZone: Record<ZoneId, { cold: number; hot: number; minOp: number; maxOp: number }>;
  /** coldest inner surface of the windows and walls on the coldest hour, degC */
  minWindowSurface: number;
  minWallSurface: number;
  /** dew point of the indoor air at that hour (assumed 50% RH), degC */
  dewPoint: number;
  coldestHour: number;
}

export interface Balance {
  windows: number;
  walls: number;
  roof: number;
  floor: number;
  ventilation: number;
  solar: number;
  internal: number;
  /** heat delivered by the system in the same hours */
  heating: number;
}

export interface Design {
  tDesign: number;
  loadW: number;
  perZone: Record<ZoneId, number>;
  /** rated heat pump output at 7 degC outdoor, W (0 when there is none) */
  hpRatedW: number;
  /** water temperature needed on the design day, degC (hydronic systems) */
  designSupply: number;
  /** heat loss coefficient of the whole flat, W/K */
  lossCoefficient: number;
}

export interface SimResult {
  scenario: Scenario;
  climate: Pick<Climate, 'id' | 'name' | 'kind' | 'year' | 'lat' | 'lon' | 'tz' | 'source'>;
  zones: Record<ZoneId, ZoneSeries>;
  outdoor: Float32Array;
  supply: Float32Array;
  cop: Float32Array;
  elecW: Float32Array;
  gasW: Float32Array;
  pvW: Float32Array;
  /** 1 heating, -1 cooling, 0 off */
  mode: Int8Array;
  totals: Totals;
  monthly: { heat: number; cool: number; elec: number; gas: number }[];
  comfort: Comfort;
  balance: Balance;
  design: Design;
  /** room that has an emitter / a cooling unit */
  heated: Record<ZoneId, boolean>;
  cooled: Record<ZoneId, boolean>;
  warnings: string[];
}

const RHO_C = 1200 / 3600; // air heat capacity, Wh/(m3 K) -> W per (m3/h * K)
const MVHR_EFF = 0.8; // heat-recovery efficiency (editorial)
const MVHR_ACH = 0.5;
const MVHR_LEAK_ACH = 0.1;
const MVHR_FAN_W_PER_M3H = 0.3; // specific fan power (editorial)
const PUMP_W = 30;
const NIGHT_VENT_ACH = 4;
const DAY_AIRING_ACH = 2;
const ALPHA = 0.6;
const RSE = 0.04;
const HR = 4.5;
const DT_SKY = 11;
const FRAME = 0.8;
const FW = 0.9;
const SHUTTER = 0.2;
const RSI = 0.13;
const BASE_LOAD_KWH = 2700; // typical Italian household, see ARERA (source id arera-typical)
const PV_PR = 0.8;
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

const monthOf = (day: number) => {
  let m = 0;
  while (m < 11 && day >= MONTH_START[m + 1]) m++;
  return m;
};

/** Sensible internal gains of the whole flat, W, by local hour (editorial profile, about 5 W/m2 on average). */
export function internalGains(localHour: number, occupants: number): number {
  const h = localHour;
  const home = h < 8 || h >= 18;
  const people = home ? occupants * (h < 7 ? 65 : 80) : Math.min(occupants, 1) * 80;
  let appliances = 140;
  if (h >= 7 && h < 9) appliances += 200;
  if (h >= 12 && h < 14) appliances += 120;
  if (h >= 18 && h < 22) appliances += 380;
  return people + appliances;
}

/** Household electricity outside heating and cooling, W, shaped by hour and scaled to BASE_LOAD_KWH (editorial). */
const BASE_SHAPE = [0.6, 0.55, 0.5, 0.5, 0.5, 0.55, 0.8, 1.2, 1.1, 0.9, 0.85, 0.9, 1.1, 1.0, 0.85, 0.8, 0.85, 1.0, 1.4, 1.7, 1.75, 1.5, 1.1, 0.8];
const BASE_SHAPE_MEAN = BASE_SHAPE.reduce((a, b) => a + b, 0) / 24;
const baseLoadW = (localHour: number) => ((BASE_LOAD_KWH * 1000) / HOURS) * (BASE_SHAPE[localHour] / BASE_SHAPE_MEAN);

/** Share of the day's hot water drawn in each local hour (editorial). */
const DHW_SHAPE: Record<number, number> = { 7: 0.3, 8: 0.1, 13: 0.1, 20: 0.3, 21: 0.2 };

function occupied(id: ZoneId, h: number): boolean {
  switch (id) {
    case 'living':
      return h >= 7 && h < 23;
    case 'kitchen':
      return (h >= 7 && h < 9) || (h >= 12 && h < 14) || (h >= 18 && h < 22);
    case 'bath':
      return (h >= 6 && h < 9) || (h >= 19 && h < 23);
    default:
      return h >= 22 || h < 7;
  }
}

/** Magnus formula, degC. */
export function dewPoint(t: number, rh: number): number {
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(rh / 100) + (a * t) / (b + t);
  return (b * g) / (a - g);
}

interface ZoneModel {
  id: ZoneId;
  area: number;
  volume: number;
  windows: { area: number; az: number }[];
  walls: { area: number; az: number }[];
  roofArea: number;
  htrW: number;
  uaWalls: number;
  uaRoof: number;
  uaFloorExt: number;
  uaGround: number;
  htrOp: number;
  htrEm: number;
  htrIs: number;
  htrMs: number;
  at: number;
  am: number;
  cm: number;
  hveBase: number;
  gainShare: number;
  neighbours: { j: number; h: number }[];
}

function buildZones(s: Scenario): ZoneModel[] {
  const exposed = new Set<Side>(EXPOSURES.find((e) => e.id === s.exposure)?.sides ?? ['front', 'back']);
  const mass = MASS[s.mass] ?? MASS.heavy;
  const env = s.env;
  const models = ZONES.map((z) => {
    const area = zoneArea(z);
    const volume = area * HEIGHT;
    const windows: ZoneModel['windows'] = [];
    const walls: ZoneModel['walls'] = [];
    for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
      const len = sideLength(z, side);
      if (!len || !exposed.has(side)) continue;
      const az = sideAzimuth(side, s.frontFacing);
      const win = z.windows.filter((w) => w.side === side).reduce((a, w) => a + w.area, 0);
      if (win > 0) windows.push({ area: win, az });
      walls.push({ area: Math.max(0, len * HEIGHT - win), az });
    }
    const winArea = windows.reduce((a, w) => a + w.area, 0);
    const wallArea = walls.reduce((a, w) => a + w.area, 0);
    const roofArea = s.above === 'roof' ? area : 0;
    const htrW = env.uWindow * winArea;
    const uaWalls = env.uWall * wallArea;
    const uaRoof = env.uRoof * roofArea;
    const uaFloorExt = s.below === 'unheated' ? env.uFloor * area * B_UNHEATED : 0;
    const uaGround = s.below === 'ground' ? env.uFloor * area : 0;
    const htrOp = Math.max(0.1, uaWalls + uaRoof + uaFloorExt + uaGround);
    const at = 4.5 * area;
    const am = mass.am * area;
    const htrMs = 9.1 * am;
    const htrEm = htrOp < htrMs ? 1 / (1 / htrOp - 1 / htrMs) : htrOp * 10;
    const ach = s.ventilation === 'mvhr' ? MVHR_ACH * (1 - MVHR_EFF) + MVHR_LEAK_ACH : Math.max(0.3, env.ach);
    return {
      id: z.id,
      area,
      volume,
      windows,
      walls,
      roofArea,
      htrW,
      uaWalls,
      uaRoof,
      uaFloorExt,
      uaGround,
      htrOp,
      htrEm,
      htrIs: 3.45 * at,
      htrMs,
      at,
      am,
      cm: mass.cm * area,
      hveBase: RHO_C * ach * volume,
      gainShare: z.gainShare,
      neighbours: [] as { j: number; h: number }[],
    } satisfies ZoneModel;
  });
  for (let i = 0; i < ZONES.length; i++) {
    for (let j = 0; j < ZONES.length; j++) {
      if (i === j) continue;
      let h = U_PARTITION * sharedLength(ZONES[i], ZONES[j]) * HEIGHT;
      for (const [a, b, w] of DOORS) if ((a === ZONES[i].id && b === ZONES[j].id) || (b === ZONES[i].id && a === ZONES[j].id)) h += w;
      if (h > 0) models[i].neighbours.push({ j, h });
    }
  }
  return models;
}

interface StepIn {
  te: number;
  /** conductance from the air node to the supply side (ventilation + neighbouring rooms), W/K */
  hve: number;
  /** temperature on the supply side: weighted mix of outdoor air and neighbouring rooms */
  tsup: number;
  phiIa: number;
  phiSt: number;
  phiM: number;
  tmPrev: number;
}

interface StepOut {
  air: number;
  surf: number;
  tm: number;
  tmEnd: number;
}

/** One hour of the EN ISO 13790 5R1C network (Annex C), heat input already split between the nodes. */
function step(z: ZoneModel, p: StepIn, out: StepOut): StepOut {
  const hve = Math.max(1e-3, p.hve);
  const h1 = 1 / (1 / hve + 1 / z.htrIs);
  const h2 = h1 + z.htrW;
  const h3 = 1 / (1 / h2 + 1 / z.htrMs);
  const phiMtot = p.phiM + z.htrEm * p.te + (h3 * (p.phiSt + z.htrW * p.te + h1 * (p.phiIa / hve + p.tsup))) / h2;
  const c = z.cm / 3600;
  const tmEnd = (p.tmPrev * (c - 0.5 * (h3 + z.htrEm)) + phiMtot) / (c + 0.5 * (h3 + z.htrEm));
  const tm = 0.5 * (tmEnd + p.tmPrev);
  const surf = (z.htrMs * tm + p.phiSt + z.htrW * p.te + h1 * (p.tsup + p.phiIa / hve)) / (z.htrMs + z.htrW + h1);
  const air = (z.htrIs * surf + hve * p.tsup + p.phiIa) / (z.htrIs + hve);
  out.air = air;
  out.surf = surf;
  out.tm = tm;
  out.tmEnd = tmEnd;
  return out;
}

const zoneRecord = <T,>(f: (id: ZoneId) => T) => Object.fromEntries(ZONES.map((z) => [z.id, f(z.id)])) as Record<ZoneId, T>;

/** Water temperature the emitters need on the design day, degC. */
function designSupplyTemp(emitter: EmitterId): number {
  const e = emitterInfo(emitter);
  return 20 + e.dtDesign * Math.pow(1 / e.size, 1 / e.n) + e.dtWater / 2;
}

export function simulate(s: Scenario, c: Climate, prices: ControlPrices = { electricity: 0.28, gasPerKWh: 0.11 }): SimResult {
  const zones = buildZones(s);
  const n = zones.length;
  const gen = generatorInfo(s.generator);
  const em = emitterInfo(s.emitter);
  const hydronic = gen.hydronic;
  const meanT = annualMean(c.t);
  const tGround = meanT;
  const tDesign = designTemperature(c, 0.004);
  const warnings: string[] = [];

  // --- which rooms are served
  const splitRooms = new Set<ZoneId>(['living', 'bed1', 'bed2']);
  const heated = zoneRecord((id) => (s.generator === 'split' ? splitRooms.has(id) || id === 'bath' : true));
  const coolSplit = s.cooling === 'split' || (s.cooling !== 'none' && s.generator === 'split');
  const coolHydronic = s.cooling === 'system' && hydronic && gen.reversible && em.coolWm2 > 0;
  if (s.cooling === 'system' && !coolHydronic && s.generator !== 'split') {
    warnings.push(gen.reversible ? 'These emitters cannot cool: choose underfloor heating or fan coils, or add split air conditioners.' : 'This system cannot cool: add split air conditioners for summer.');
  }
  const cooled = zoneRecord((id) => (coolSplit ? splitRooms.has(id) : coolHydronic ? id !== 'bath' : false));

  // --- design heat loss per room (EN 12831 style, steady state, no gains)
  const perZone = zoneRecord(() => 0);
  let lossCoefficient = 0;
  zones.forEach((z) => {
    const h = z.htrW + z.uaWalls + z.uaRoof + z.uaFloorExt + z.hveBase;
    lossCoefficient += h + z.uaGround;
    perZone[z.id] = h * (20 - tDesign) + z.uaGround * (20 - tGround);
  });
  const loadW = Object.values(perZone).reduce((a, b) => a + b, 0);
  const designSupply = hydronic ? designSupplyTemp(s.emitter) : 0;

  // --- generator sizing
  const isAirHp = s.generator === 'hp-air' || s.generator === 'hybrid';
  let hpRatedW = 0;
  if (s.generator === 'hp-air') hpRatedW = (loadW * s.hpSize) / airHpCapacityFactor(tDesign, designSupply);
  if (s.generator === 'hybrid') hpRatedW = (loadW * s.hpSize * 0.6) / airHpCapacityFactor(tDesign, Math.min(designSupply, 55));
  if (s.generator === 'hp-ground') hpRatedW = loadW * s.hpSize;
  if (hpRatedW) hpRatedW = Math.max(3000, hpRatedW);
  const splitRated = zoneRecord((id) => {
    if (!splitRooms.has(id)) return 0;
    const extra = id === 'living' ? perZone.kitchen : 0;
    return Math.max(2000, (perZone[id] + extra) * 1.2);
  });
  const towelRailW = 500;
  const hpMaxSupply = isAirHp ? HP_AIR.maxSupply : HP_GROUND.maxSupply;
  const maxSupply = s.generator === 'hp-air' || s.generator === 'hp-ground' ? hpMaxSupply : 80;
  if (hydronic && (s.generator === 'hp-air' || s.generator === 'hp-ground') && designSupply > hpMaxSupply) {
    warnings.push(`On the coldest days these radiators need about ${Math.round(designSupply)} °C water, more than this heat pump delivers (${hpMaxSupply} °C): rooms may fall short unless you insulate or fit larger emitters.`);
  }
  // emitter capacity per room at the generator's top water temperature
  const capHeat = zoneRecord((id) => {
    const z = zones.find((m) => m.id === id)!;
    if (!heated[id]) return 0;
    if (hydronic) return emitterOutput(em, perZone[id], z.area, maxSupply - em.dtWater / 2, s.heatSet);
    if (s.generator === 'split') return id === 'bath' ? towelRailW : splitRated[id];
    return Math.max(500, perZone[id] * 1.5);
  });

  // --- series
  const zs = zoneRecord(() => ({
    air: new Float32Array(HOURS),
    op: new Float32Array(HOURS),
    surf: new Float32Array(HOURS),
    q: new Float32Array(HOURS),
    lossWin: new Float32Array(HOURS),
    lossOpaque: new Float32Array(HOURS),
    lossVent: new Float32Array(HOURS),
  }));
  const supplyS = new Float32Array(HOURS);
  const copS = new Float32Array(HOURS);
  const elecS = new Float32Array(HOURS);
  const gasS = new Float32Array(HOURS);
  const pvS = new Float32Array(HOURS);
  const modeS = new Int8Array(HOURS);

  const totals: Totals = {
    spaceHeatKWh: 0,
    coolKWh: 0,
    dhwKWh: 0,
    elecKWh: 0,
    elecGridKWh: 0,
    gasKWh: 0,
    backupKWh: 0,
    auxKWh: 0,
    pvKWh: 0,
    pvToHvacKWh: 0,
    pvToBaseKWh: 0,
    pvExportKWh: 0,
    hpHeatKWh: 0,
    hpElecKWh: 0,
    boilerHeatKWh: 0,
    unmetKWh: 0,
    coolElecKWh: 0,
  };
  const monthly = Array.from({ length: 12 }, () => ({ heat: 0, cool: 0, elec: 0, gas: 0 }));
  const balance: Balance = { windows: 0, walls: 0, roof: 0, floor: 0, ventilation: 0, solar: 0, internal: 0, heating: 0 };
  const perZoneComfort = zoneRecord(() => ({ cold: 0, hot: 0, minOp: Infinity, maxOp: -Infinity }));
  let coldHours = 0;
  let hotHours = 0;

  // --- state
  const tm = new Float64Array(n).fill(s.heatSet);
  const air = new Float64Array(n).fill(s.heatSet);
  const airNext = new Float64Array(n);
  const o0: StepOut = { air: 0, surf: 0, tm: 0, tmEnd: 0 };
  const o1: StepOut = { air: 0, surf: 0, tm: 0, tmEnd: 0 };
  const of: StepOut = { air: 0, surf: 0, tm: 0, tmEnd: 0 };
  const base = { hc: new Float64Array(n), tsup: new Float64Array(n), ia: new Float64Array(n), st: new Float64Array(n), m: new Float64Array(n), hve: new Float64Array(n), sol: new Float64Array(n), int: new Float64Array(n) };
  const sens = new Float64Array(n);
  const free = new Float64Array(n);
  const qz = new Float64Array(n);
  const splitN = hydronic ? em.split : s.generator === 'split' ? AIR_SPLIT : PANEL_SPLIT;
  let trm = meanT; // running mean outdoor temperature (EN 16798-1)
  let dayMean = 0;

  const tCold = Math.max(8, meanT);
  const dhwDayKWh = (s.dhwLitres * 4.186 * (40 - tCold)) / 3600;
  const dhwSource: 'boiler' | 'boiler-old' | 'hp-air' | 'hp-ground' | 'hybrid' | 'electric' | 'hpwh' | 'gas' =
    s.dhw === 'hp-water-heater' ? 'hpwh' : s.dhw === 'electric' ? 'electric' : s.dhw === 'gas' ? 'gas' : s.generator === 'split' || s.generator === 'electric' ? 'electric' : s.generator;
  const tank = dhwSource !== 'boiler' && dhwSource !== 'boiler-old' && dhwSource !== 'gas';
  const mvhrW = s.ventilation === 'mvhr' ? zones.reduce((a, z) => a + z.volume, 0) * MVHR_ACH * MVHR_FAN_W_PER_M3H : 0;

  const WARM = 720;
  let coldestTe = Infinity;
  let coldestHour = 0;

  for (let k = -WARM; k < HOURS; k++) {
    const h = k < 0 ? k + HOURS : k;
    const rec = k >= 0;
    const te = c.t[h];
    const rh = c.rh[h];
    const local = (((h + c.tz) % 24) + 24) % 24;
    const day = Math.floor(h / 24);
    const month = monthOf(day);
    if (local === 0) {
      trm = 0.8 * trm + 0.2 * dayMean;
      dayMean = 0;
    }
    dayMean += te / 24;
    const summer = day >= 151 && day < 273;

    // --- solar
    const sun = sunPosition(h + c.solarOffsetH, c.lat, c.lon);
    const irr = (az: number, tilt = 90) => surfaceIrradiance(sun, c.dni[h], c.dhi[h], c.ghi[h], tilt, az);
    const gains = internalGains(local, s.occupants);
    const night = local >= 22 || local < 7;

    for (let i = 0; i < n; i++) {
      const z = zones[i];
      let sol = 0;
      for (const w of z.windows) {
        const I = irr(w.az);
        const shut = s.shutters && I > 150 && (summer || air[i] > 24) ? SHUTTER : 1;
        sol += w.area * s.env.gWindow * FRAME * FW * shut * I - 0.5 * RSE * s.env.uWindow * w.area * HR * DT_SKY;
      }
      for (const w of z.walls) sol += ALPHA * RSE * s.env.uWall * w.area * irr(w.az) - 0.5 * RSE * s.env.uWall * w.area * HR * DT_SKY;
      if (z.roofArea) sol += ALPHA * RSE * s.env.uRoof * z.roofArea * c.ghi[h] - RSE * s.env.uRoof * z.roofArea * HR * DT_SKY;
      const phiInt = gains * z.gainShare;
      // neighbouring rooms enter implicitly, like a second air supply at their (previous-hour) temperature:
      // an explicit flux H*(T_j - T_i) makes small rooms oscillate from hour to hour
      let hc = 0;
      let hcT = 0;
      for (const nb of z.neighbours) {
        hc += nb.h;
        hcT += nb.h * air[nb.j];
      }
      let hve = z.hveBase;
      // occupants open windows when it is cooler outside than in, unless the room is air-conditioned (editorial behaviour)
      if (!cooled[z.id] && air[i] > 25 && te > 12 && te < air[i] - 1) {
        if (!night) hve += RHO_C * DAY_AIRING_ACH * z.volume;
        else if (s.nightVent) hve += RHO_C * NIGHT_VENT_ACH * z.volume;
      }
      const half = 0.5 * phiInt + sol;
      const fm = z.am / z.at;
      const fst = 1 - fm - z.htrW / (9.1 * z.at);
      base.ia[i] = 0.5 * phiInt;
      base.st[i] = fst * half;
      base.m[i] = fm * half + (z.uaGround ? (z.htrEm * z.uaGround) / z.htrOp * (tGround - te) : 0);
      base.hve[i] = hve;
      base.hc[i] = hc;
      base.tsup[i] = (hve * te + hcT) / (hve + hc);
      base.sol[i] = sol;
      base.int[i] = phiInt;
      const H = hve + hc;
      const tsup = base.tsup[i];
      step(z, { te, hve: H, tsup, phiIa: base.ia[i], phiSt: base.st[i], phiM: base.m[i], tmPrev: tm[i] }, o0);
      step(z, { te, hve: H, tsup, phiIa: base.ia[i] + 1000 * splitN[0], phiSt: base.st[i] + 1000 * splitN[1], phiM: base.m[i] + 1000 * splitN[2], tmPrev: tm[i] }, o1);
      free[i] = o0.air;
      sens[i] = (o1.air - o0.air) / 1000;
    }

    // --- control: heat or cool?
    const heatSp = s.setback && (local >= 23 || local < 6) ? s.heatSet - 3 : s.heatSet;
    let needHeat = 0;
    let needCool = 0;
    for (let i = 0; i < n; i++) {
      const id = zones[i].id;
      qz[i] = 0;
      if (heated[id] && free[i] < heatSp) needHeat += Math.min(capHeat[id], (heatSp - free[i]) / sens[i]);
      if (cooled[id] && free[i] > s.coolSet) needCool += (free[i] - s.coolSet) / sens[i];
    }
    const mode: 1 | -1 | 0 = needHeat > 1 && needHeat >= needCool ? 1 : needCool > 1 ? -1 : 0;

    let elec = 0;
    let gas = 0;
    let cop = 0;
    let supply = 0;
    let unmet = 0;
    let hpHeat = 0;
    let hpElec = 0;
    let boilerHeat = 0;
    let coolElec = 0;

    if (mode === 1) {
      for (let i = 0; i < n; i++) {
        const id = zones[i].id;
        if (heated[id] && free[i] < heatSp) qz[i] = Math.min(capHeat[id], (heatSp - free[i]) / sens[i]);
      }
      const q = qz.reduce((a, b) => a + b, 0);
      if (hydronic) {
        let tmNeed = 0;
        for (let i = 0; i < n; i++) if (qz[i] > 0) tmNeed = Math.max(tmNeed, meanWaterFor(em, perZone[zones[i].id], zones[i].area, qz[i], heatSp));
        const dtw = em.dtWater * Math.min(1, Math.max(0.3, q / (loadW * em.size)));
        supply = Math.min(maxSupply, Math.max(25, tmNeed + dtw / 2));
        const ret = supply - dtw;
        if (s.generator === 'boiler') {
          const eta = condensingEfficiency(ret);
          gas = q / eta;
          boilerHeat = q;
          cop = eta;
        } else if (s.generator === 'boiler-old') {
          gas = q / OLD_BOILER_EFFICIENCY;
          boilerHeat = q;
          cop = OLD_BOILER_EFFICIENCY;
        } else {
          const ground = s.generator === 'hp-ground';
          const brine = groundBrine(meanT, h);
          const capF = ground ? 1 : airHpCapacityFactor(te, supply);
          const cap = hpRatedW * capF;
          const hpCan = supply <= hpMaxSupply;
          let copHp = ground ? carnotCop(HP_GROUND.quality, supply + HP_GROUND.sinkApproach, brine - HP_GROUND.srcApproach) : airHpHeatingCop(HP_AIR, te, rh, supply);
          copHp *= cyclingFactor(Math.min(q, cap), hpRatedW);
          if (s.generator === 'hybrid') {
            const eta = condensingEfficiency(ret);
            const hpCheaper = prices.electricity / copHp <= prices.gasPerKWh / eta;
            hpHeat = hpCan && hpCheaper ? Math.min(q, cap) : 0;
            boilerHeat = q - hpHeat;
            hpElec = hpHeat / copHp;
            gas = boilerHeat / eta;
            elec = hpElec;
            cop = hpHeat > 0 ? copHp : eta;
          } else {
            hpHeat = Math.min(q, cap);
            hpElec = hpHeat / copHp;
            const deficit = q - hpHeat;
            if (deficit > 0 && s.backup) {
              elec = hpElec + deficit;
              if (rec) totals.backupKWh += deficit / 1000;
            } else if (deficit > 0) {
              unmet = deficit;
              const scale = hpHeat / q;
              for (let i = 0; i < n; i++) qz[i] *= scale;
              elec = hpElec;
            } else elec = hpElec;
            cop = copHp;
          }
        }
        elec += PUMP_W;
      } else if (s.generator === 'split') {
        let sumCop = 0;
        let sumQ = 0;
        for (let i = 0; i < n; i++) {
          const id = zones[i].id;
          if (qz[i] <= 0) continue;
          if (id === 'bath') {
            elec += qz[i];
            continue;
          }
          const capU = splitRated[id] * airHpCapacityFactor(te, 35);
          if (qz[i] > capU) {
            unmet += qz[i] - capU;
            qz[i] = capU;
          }
          const copU = airHpHeatingCop(HP_SPLIT, te, rh, heatSp) * cyclingFactor(qz[i], splitRated[id]);
          elec += qz[i] / copU;
          hpHeat += qz[i];
          hpElec += qz[i] / copU;
          sumCop += copU * qz[i];
          sumQ += qz[i];
        }
        cop = sumQ > 0 ? sumCop / sumQ : 0;
      } else {
        elec = q;
        cop = 1;
      }
    } else if (mode === -1) {
      for (let i = 0; i < n; i++) {
        const id = zones[i].id;
        if (!cooled[id] || free[i] <= s.coolSet) continue;
        const capC = coolHydronic ? em.coolWm2 * zones[i].area : splitRated[id] || 2500;
        qz[i] = -Math.min(capC, (free[i] - s.coolSet) / sens[i]);
      }
      const qc = -qz.reduce((a, b) => a + b, 0);
      if (coolHydronic) {
        supply = em.coolSupply;
        const ground = s.generator === 'hp-ground';
        const eer = ground ? coolingEer(HP_GROUND, groundBrine(meanT, h) - 3, supply) : coolingEer(HP_AIR, te, supply);
        coolElec = qc / eer + PUMP_W;
        cop = eer;
      } else {
        let sumE = 0;
        for (let i = 0; i < n; i++) {
          if (qz[i] >= 0) continue;
          const eer = coolingEer(HP_SPLIT, te, free[i] - 10);
          coolElec += -qz[i] / eer;
          sumE += eer * -qz[i];
        }
        cop = qc > 0 ? sumE / qc : 0;
      }
      elec += coolElec;
    }

    // --- final temperatures with the delivered heat
    let hourWin = 0;
    let hourOpaque = 0;
    let hourVent = 0;
    let hourRoof = 0;
    let hourFloor = 0;
    for (let i = 0; i < n; i++) {
      const z = zones[i];
      const q = qz[i];
      const split = hydronic ? em.split : s.generator === 'split' || q < 0 ? AIR_SPLIT : PANEL_SPLIT;
      step(z, { te, hve: base.hve[i] + base.hc[i], tsup: base.tsup[i], phiIa: base.ia[i] + q * split[0], phiSt: base.st[i] + q * split[1], phiM: base.m[i] + q * split[2], tmPrev: tm[i] }, of);
      tm[i] = of.tmEnd;
      airNext[i] = of.air;
      const lw = z.htrW * (of.surf - te);
      const groundCorr = z.uaGround ? ((z.htrEm * z.uaGround) / z.htrOp) * (tGround - te) : 0;
      const lo = z.htrEm * (of.tm - te) - groundCorr;
      const lv = base.hve[i] * (of.air - te);
      if (rec) {
        const sz = zs[z.id];
        sz.air[k] = of.air;
        sz.surf[k] = of.surf;
        const op = 0.5 * (of.air + of.surf);
        sz.op[k] = op;
        sz.q[k] = q;
        sz.lossWin[k] = lw;
        sz.lossOpaque[k] = lo;
        sz.lossVent[k] = lv;
        hourWin += lw;
        hourVent += lv;
        const uaOp = z.htrOp;
        hourOpaque += (lo * z.uaWalls) / uaOp;
        hourRoof += (lo * z.uaRoof) / uaOp;
        hourFloor += (lo * (z.uaFloorExt + z.uaGround)) / uaOp;
        // comfort
        if (occupied(z.id, local)) {
          const pc = perZoneComfort[z.id];
          pc.minOp = Math.min(pc.minOp, op);
          pc.maxOp = Math.max(pc.maxOp, op);
          if (op < heatSp - 1.5) {
            pc.cold++;
            coldHours++;
          }
          const hotLimit = cooled[z.id] ? s.coolSet + 1.5 : trm >= 10 ? 0.33 * Math.min(30, trm) + 18.8 + 3 : 27;
          if (op > hotLimit) {
            pc.hot++;
            hotHours++;
          }
        }
      }
    }
    air.set(airNext);

    // --- hot water
    const dhwShare = DHW_SHAPE[local] ?? 0;
    const dhwUseful = (dhwDayKWh * 1000 * dhwShare) + (tank ? (TANK_LOSS_KWH_DAY * 1000) / 24 : 0);
    let dhwElec = 0;
    let dhwGas = 0;
    if (dhwUseful > 0) {
      switch (dhwSource) {
        case 'boiler':
        case 'gas':
          dhwGas = dhwUseful / DHW_BOILER_EFFICIENCY;
          boilerHeat += dhwUseful;
          break;
        case 'boiler-old':
          dhwGas = dhwUseful / 0.75;
          boilerHeat += dhwUseful;
          break;
        case 'hp-air':
        case 'hp-ground':
        case 'hybrid': {
          const ground = dhwSource === 'hp-ground';
          const copD = ground ? carnotCop(HP_GROUND.quality, 55, groundBrine(meanT, h) - HP_GROUND.srcApproach) : airHpHeatingCop(HP_AIR, te, rh, 52);
          if (dhwSource === 'hybrid' && prices.electricity / copD > prices.gasPerKWh / DHW_BOILER_EFFICIENCY) {
            dhwGas = dhwUseful / DHW_BOILER_EFFICIENCY;
            boilerHeat += dhwUseful;
          } else {
            dhwElec = dhwUseful / copD;
            hpHeat += dhwUseful;
            hpElec += dhwElec;
          }
          break;
        }
        case 'hpwh':
          dhwElec = dhwUseful / DHW_HPWH_COP;
          break;
        default:
          dhwElec = dhwUseful;
      }
    }
    elec += dhwElec + mvhrW;
    gas += dhwGas;

    // --- PV
    const pv = s.pvKwp > 0 ? s.pvKwp * PV_PR * irr(180, 30) : 0;
    const baseL = baseLoadW(local);
    const pvLeft = Math.max(0, pv - baseL);
    const pvHvac = Math.min(pvLeft, elec);

    if (rec) {
      const qHeat = Math.max(0, qz.reduce((a, b) => a + b, 0));
      const qCool = Math.max(0, -qz.reduce((a, b) => a + b, 0));
      supplyS[k] = supply;
      copS[k] = cop;
      elecS[k] = elec;
      gasS[k] = gas;
      pvS[k] = pv;
      modeS[k] = mode;
      totals.spaceHeatKWh += qHeat / 1000;
      totals.coolKWh += qCool / 1000;
      totals.dhwKWh += dhwUseful / 1000;
      totals.elecKWh += elec / 1000;
      totals.gasKWh += gas / 1000;
      totals.auxKWh += ((mode !== 0 && hydronic ? PUMP_W : 0) + mvhrW) / 1000;
      totals.pvKWh += pv / 1000;
      totals.pvToHvacKWh += pvHvac / 1000;
      totals.pvToBaseKWh += Math.min(pv, baseL) / 1000;
      totals.pvExportKWh += (pvLeft - pvHvac) / 1000;
      totals.elecGridKWh += (elec - pvHvac) / 1000;
      totals.hpHeatKWh += hpHeat / 1000;
      totals.hpElecKWh += hpElec / 1000;
      totals.boilerHeatKWh += boilerHeat / 1000;
      totals.unmetKWh += unmet / 1000;
      totals.coolElecKWh += coolElec / 1000;
      monthly[month].heat += qHeat / 1000;
      monthly[month].cool += qCool / 1000;
      monthly[month].elec += elec / 1000;
      monthly[month].gas += gas / 1000;
      if (mode === 1) {
        balance.windows += hourWin / 1000;
        balance.walls += hourOpaque / 1000;
        balance.roof += hourRoof / 1000;
        balance.floor += hourFloor / 1000;
        balance.ventilation += hourVent / 1000;
        balance.solar += base.sol.reduce((a, b) => a + b, 0) / 1000;
        balance.internal += base.int.reduce((a, b) => a + b, 0) / 1000;
        balance.heating += qHeat / 1000;
      }
      if (te < coldestTe) {
        coldestTe = te;
        coldestHour = k;
      }
    }
  }

  // --- cold surfaces at the coldest hour
  let minWin = Infinity;
  let minWall = Infinity;
  let dew = -Infinity;
  for (const z of zones) {
    const ta = zs[z.id].air[coldestHour];
    const dT = ta - c.t[coldestHour];
    if (z.windows.length) minWin = Math.min(minWin, ta - s.env.uWindow * RSI * dT);
    if (z.walls.length) minWall = Math.min(minWall, ta - s.env.uWall * RSI * dT);
    dew = Math.max(dew, dewPoint(ta, 50));
  }

  if (totals.unmetKWh > 20 || coldHours > 200) warnings.push('Some rooms stay below the set-point on cold days: the system or the emitters are too small for this home.');
  if (s.generator === 'boiler' && totals.boilerHeatKWh > 0) {
    // nothing: condensing efficiency already reflects the water temperature
  }

  for (const id of Object.keys(perZoneComfort) as ZoneId[]) {
    const p = perZoneComfort[id];
    if (!Number.isFinite(p.minOp)) p.minOp = 0;
    if (!Number.isFinite(p.maxOp)) p.maxOp = 0;
  }

  return {
    scenario: s,
    climate: { id: c.id, name: c.name, kind: c.kind, year: c.year, lat: c.lat, lon: c.lon, tz: c.tz, source: c.source },
    zones: zs,
    outdoor: c.t,
    supply: supplyS,
    cop: copS,
    elecW: elecS,
    gasW: gasS,
    pvW: pvS,
    mode: modeS,
    totals,
    monthly,
    comfort: { coldHours, hotHours, perZone: perZoneComfort, minWindowSurface: minWin, minWallSurface: minWall, dewPoint: dew, coldestHour },
    balance,
    design: { tDesign, loadW, perZone, hpRatedW, designSupply, lossCoefficient },
    heated,
    cooled,
    warnings,
  };
}

/** Seasonal performance of the heat pump part (space heating + hot water), 0 when there is none. */
export function seasonalCop(r: SimResult): number {
  return r.totals.hpElecKWh > 0 ? r.totals.hpHeatKWh / r.totals.hpElecKWh : 0;
}
