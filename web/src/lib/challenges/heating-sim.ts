/**
 * Home heating simulator: yearly energy, running cost and CO2 of a gas boiler,
 * a heat pump and a hybrid system delivering the same useful heat.
 *
 * Deliberately simple and transparent. Every assumption is an input the visitor can change.
 * The default emission factors come from ISPRA (see home-heating.json, sources
 * ispra-elec-2025 and ispra-gas-standard); default prices are examples, not quotes.
 */

export interface HeatingInputs {
  /** useful heat delivered to the home in a year, kWh */
  heatDemandKWh: number;
  /** seasonal boiler efficiency on lower heating value, 0..1.1 */
  boilerEfficiency: number;
  /** seasonal coefficient of performance of the heat pump */
  scop: number;
  /** share of the heat covered by the heat pump in the hybrid system, 0..1 */
  hybridHpShare: number;
  /** gas price, euro per standard cubic metre */
  gasPricePerSmc: number;
  /** electricity price, euro per kWh */
  electricityPricePerKWh: number;
  /** lower heating value of natural gas, kWh per Smc */
  gasKWhPerSmc: number;
  /** kg CO2 per kWh of gas burnt */
  gasKgCo2PerKWh: number;
  /** kg CO2 per kWh of electricity consumed */
  electricityKgCo2PerKWh: number;
}

export interface SystemResult {
  id: 'boiler' | 'heat-pump' | 'hybrid';
  label: string;
  gasSmc: number;
  electricityKWh: number;
  costEur: number;
  co2Kg: number;
}

/** 35.457 GJ / 1000 Sm3 (ISPRA standard parameters) = 9.849 kWh/Sm3 */
export const GAS_KWH_PER_SMC = 35.457 / 3.6;
/** 56.518 tCO2/TJ (ISPRA standard parameters) = 0.2035 kg/kWh */
export const GAS_KG_CO2_PER_KWH = 56.518 / 277.7778;
/** ISPRA, electricity consumption 2024 (preliminary) */
export const ELECTRICITY_KG_CO2_PER_KWH = 0.1989;

export const DEFAULT_INPUTS: HeatingInputs = {
  heatDemandKWh: 10000,
  boilerEfficiency: 0.92,
  scop: 3.5,
  hybridHpShare: 0.75,
  gasPricePerSmc: 1.1,
  electricityPricePerKWh: 0.28,
  gasKWhPerSmc: GAS_KWH_PER_SMC,
  gasKgCo2PerKWh: GAS_KG_CO2_PER_KWH,
  electricityKgCo2PerKWh: ELECTRICITY_KG_CO2_PER_KWH,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pos = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

/**
 * Rough seasonal COP from the Carnot limit: COP = f * T_flow / (T_flow - T_outdoor), temperatures in kelvin.
 * f (fraction of Carnot reached by real machines) defaults to 0.45, a common rule of thumb; treat the
 * result as an order of magnitude, not a datasheet value. Clamped to 1..7.
 */
export function estimateScop(flowTempC: number, meanOutdoorTempC: number, carnotFraction = 0.45): number {
  const tFlow = flowTempC + 273.15;
  const lift = flowTempC - meanOutdoorTempC;
  if (!(lift > 0)) return 7;
  return clamp((carnotFraction * tFlow) / lift, 1, 7);
}

function result(id: SystemResult['id'], label: string, gasKWh: number, elecKWh: number, i: HeatingInputs): SystemResult {
  const gasSmc = i.gasKWhPerSmc > 0 ? gasKWh / i.gasKWhPerSmc : 0;
  return {
    id,
    label,
    gasSmc,
    electricityKWh: elecKWh,
    costEur: gasSmc * pos(i.gasPricePerSmc) + elecKWh * pos(i.electricityPricePerKWh),
    co2Kg: gasKWh * pos(i.gasKgCo2PerKWh) + elecKWh * pos(i.electricityKgCo2PerKWh),
  };
}

export function simulate(input: HeatingInputs): SystemResult[] {
  const q = pos(input.heatDemandKWh);
  const eta = pos(input.boilerEfficiency) || 1;
  const cop = pos(input.scop) || 1;
  const share = clamp(Number.isFinite(input.hybridHpShare) ? input.hybridHpShare : 0, 0, 1);
  return [
    result('boiler', 'Condensing gas boiler', q / eta, 0, input),
    result('heat-pump', 'Heat pump', 0, q / cop, input),
    result('hybrid', `Hybrid (${Math.round(share * 100)}% heat pump)`, ((1 - share) * q) / eta, (share * q) / cop, input),
  ];
}

/**
 * Electricity price (euro/kWh) at which the heat pump costs the same to run as the boiler.
 * Below it the heat pump is cheaper. Independent of the heat demand.
 */
export function breakEvenElectricityPrice(input: HeatingInputs): number {
  const gasPerKWh = input.gasKWhPerSmc > 0 ? pos(input.gasPricePerSmc) / input.gasKWhPerSmc : 0;
  const eta = pos(input.boilerEfficiency) || 1;
  return (gasPerKWh / eta) * (pos(input.scop) || 1);
}
