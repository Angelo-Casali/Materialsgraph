/**
 * Hourly climate for the simulator: 8760 values per variable (non-leap year, UTC hours).
 *
 * Two kinds:
 * - presets: typical meteorological years from PVGIS 5.3 (EU Joint Research Centre), built by
 *   scripts/build_climate_presets.py and served from public/data/climate/
 * - any place: one real year of ERA5-based weather from the Open-Meteo historical API
 *   (CC BY 4.0), fetched by the visitor's browser
 */

export interface Climate {
  id: string;
  name: string;
  country?: string;
  lat: number;
  lon: number;
  /** UTC offset of local standard time, hours */
  tz: number;
  kind: 'tmy' | 'year';
  year?: number;
  source: 'pvgis-tmy' | 'open-meteo';
  /** hours to add to the UTC timestamp to get the instant the irradiance values represent */
  solarOffsetH: number;
  /** air temperature, degC */
  t: Float32Array;
  /** relative humidity, % */
  rh: Float32Array;
  /** global horizontal, direct normal and diffuse horizontal irradiance, W/m2 */
  ghi: Float32Array;
  dni: Float32Array;
  dhi: Float32Array;
  /** wind speed at 10 m, m/s */
  ws: Float32Array;
}

export interface PresetSummary {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  zone: string | null;
  meanC: number;
  minC: number;
  maxC: number;
}

export const HOURS = 8760;

interface PresetFile {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  tz: number;
  t: number[];
  rh: number[];
  ghi: number[];
  dni: number[];
  dhi: number[];
  ws: number[];
}

const base = () => (import.meta.env?.BASE_URL ?? '/');

export function climateFromPreset(f: PresetFile): Climate {
  const scaled = (a: number[], k: number) => Float32Array.from(a, (v) => v * k);
  return {
    id: f.id,
    name: f.name,
    country: f.country,
    lat: f.lat,
    lon: f.lon,
    tz: f.tz,
    kind: 'tmy',
    source: 'pvgis-tmy',
    // PVGIS SARAH irradiance is instantaneous, about 10 minutes after the hour
    solarOffsetH: 0.17,
    t: scaled(f.t, 0.1),
    rh: scaled(f.rh, 1),
    ghi: scaled(f.ghi, 1),
    dni: scaled(f.dni, 1),
    dhi: scaled(f.dhi, 1),
    ws: scaled(f.ws, 0.1),
  };
}

export async function loadPresetIndex(): Promise<PresetSummary[]> {
  const r = await fetch(`${base()}data/climate/index.json`);
  if (!r.ok) throw new Error(`climate index: HTTP ${r.status}`);
  return r.json();
}

const cache = new Map<string, Promise<Climate>>();

export function loadPreset(id: string): Promise<Climate> {
  if (!/^[a-z-]+$/.test(id)) return Promise.reject(new Error('bad preset id'));
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${base()}data/climate/${id}.json`).then(async (r) => {
      if (!r.ok) throw new Error(`climate ${id}: HTTP ${r.status}`);
      return climateFromPreset(await r.json());
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export interface Place {
  name: string;
  admin?: string;
  country?: string;
  lat: number;
  lon: number;
}

/** Place search (Open-Meteo geocoding, GeoNames data, CC BY 4.0). */
export async function searchPlaces(q: string, language = 'en'): Promise<Place[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=6&language=${language}&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`place search: HTTP ${r.status}`);
  const j = (await r.json()) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
  return (j.results ?? []).map((x) => ({ name: x.name, admin: x.admin1, country: x.country, lat: x.latitude, lon: x.longitude }));
}

interface OpenMeteoArchive {
  utc_offset_seconds: number;
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    shortwave_radiation: (number | null)[];
    direct_normal_irradiance: (number | null)[];
    diffuse_radiation: (number | null)[];
    wind_speed_10m: (number | null)[];
  };
}

/** Converts an Open-Meteo archive response (GMT timestamps) into a Climate. Exported for tests. */
export function climateFromOpenMeteo(j: OpenMeteoArchive, place: Place, year: number): Climate {
  const h = j.hourly;
  const keep: number[] = [];
  h.time.forEach((t, i) => {
    if (!t.startsWith(`${year}-02-29`)) keep.push(i);
  });
  if (keep.length < HOURS) throw new Error(`incomplete year: ${keep.length} hours`);
  const take = (a: (number | null)[], k = 1) => {
    const out = new Float32Array(HOURS);
    let last = 0;
    for (let n = 0; n < HOURS; n++) {
      const v = a[keep[n]];
      if (v !== null && Number.isFinite(v)) last = v * k;
      out[n] = last;
    }
    return out;
  };
  return {
    id: `om:${place.lat.toFixed(3)},${place.lon.toFixed(3)}:${year}`,
    name: place.name,
    country: place.country,
    lat: place.lat,
    lon: place.lon,
    tz: Math.round(place.lon / 15),
    kind: 'year',
    year,
    source: 'open-meteo',
    // Open-Meteo radiation is the mean of the preceding hour
    solarOffsetH: -0.5,
    t: take(h.temperature_2m),
    rh: take(h.relative_humidity_2m),
    ghi: take(h.shortwave_radiation),
    dni: take(h.direct_normal_irradiance),
    dhi: take(h.diffuse_radiation),
    ws: take(h.wind_speed_10m, 1 / 3.6),
  };
}

/** One real year of hourly weather for any place (Open-Meteo historical API, ERA5, CC BY 4.0). */
export async function loadOpenMeteoYear(place: Place, year: number): Promise<Climate> {
  const vars = 'temperature_2m,relative_humidity_2m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation,wind_speed_10m';
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${place.lat.toFixed(4)}&longitude=${place.lon.toFixed(4)}` +
    `&start_date=${year}-01-01&end_date=${year}-12-31&hourly=${vars}&timezone=GMT`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather download: HTTP ${r.status}`);
  return climateFromOpenMeteo(await r.json(), place, year);
}

/** Outdoor temperature exceeded in all but `fraction` of the hours (design temperature for sizing). */
export function designTemperature(c: Climate, fraction = 0.01): number {
  const s = Float32Array.from(c.t).sort();
  return s[Math.floor(fraction * s.length)];
}

export function annualMean(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

/** Heating degree-days, base 20 degC indoor and 12 degC threshold (EN ISO 15927-6 / Eurostat style). */
export function heatingDegreeDays(c: Climate, base = 18): number {
  let dd = 0;
  for (let d = 0; d < 365; d++) {
    let m = 0;
    for (let h = 0; h < 24; h++) m += c.t[d * 24 + h];
    m /= 24;
    if (m < base) dd += base - m;
  }
  return dd;
}
