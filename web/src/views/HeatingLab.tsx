import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../components/bits';
import { DayPower, DayTemps, HeatBalance, MonthBars } from '../components/lab/LabCharts';
import { Stage } from '../components/lab/Stage';
import { ABOVE_OPTIONS, BELOW_OPTIONS, ENVELOPES, EXPOSURES, FLOOR_AREA, MASS, ZONES } from '../lib/sim/apartment';
import { type Climate, heatingDegreeDays, loadOpenMeteoYear, loadPreset, loadPresetIndex, type Place, type PresetSummary, searchPlaces, designTemperature, annualMean } from '../lib/sim/climate';
import { annualBill, capexItems, DEFAULT_MONEY, type Money, ownership, payback } from '../lib/sim/costs';
import { DEFAULT_SCENARIO, type Scenario, seasonalCop, type SimResult } from '../lib/sim/engine';
import { runScenario } from '../lib/sim/runner';
import { decodeLab, encodeLab, type LabState, MAX_SCENARIOS, type PlaceRef } from '../lib/sim/scenario';
import { EMITTERS, GENERATORS, generatorInfo } from '../lib/sim/systems';
import { GAS_KWH_PER_SMC } from '../lib/challenges/heating-sim';
import { href, route } from '../lib/router';
import { theme } from '../lib/prefs';

const LETTERS = ['A', 'B', 'C', 'D'];
const COMPASS: [number, string][] = [[0, 'North'], [45, 'North-east'], [90, 'East'], [135, 'South-east'], [180, 'South'], [225, 'South-west'], [270, 'West'], [315, 'North-west']];
const fmt0 = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-GB') : '–');
const fmt1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const eur = (x: number) => (Number.isFinite(x) ? `${x < -0.5 ? '−' : ''}€${Math.abs(Math.round(x)).toLocaleString('en-GB')}` : '–');

const env = (id: string) => {
  const p = ENVELOPES.find((e) => e.id === id)!;
  return { uWall: p.uWall, uRoof: p.uRoof, uFloor: p.uFloor, uWindow: p.uWindow, gWindow: p.gWindow, ach: p.ach };
};

export function defaultLab(): LabState {
  return {
    place: 'milano',
    money: DEFAULT_MONEY,
    scenarios: [
      { ...DEFAULT_SCENARIO, name: 'Today: gas boiler' },
      { ...DEFAULT_SCENARIO, name: 'Heat pump, same radiators', generator: 'hp-air' },
      { ...DEFAULT_SCENARIO, name: 'Insulate, heat pump, solar', generator: 'hp-air', envelopeId: '2006', env: env('2006'), pvKwp: 3, dhw: 'system' },
    ],
  };
}

/** Day of year (0-based) of the coldest and hottest hours, and fixed reference days. */
function referenceDays(c: Climate) {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < c.t.length; i++) {
    if (c.t[i] < c.t[lo]) lo = i;
    if (c.t[i] > c.t[hi]) hi = i;
  }
  return [
    { id: 'coldest', label: 'Coldest day', day: Math.floor(lo / 24) },
    { id: 'jan', label: 'January', day: 14 },
    { id: 'apr', label: 'April', day: 104 },
    { id: 'jul', label: 'July', day: 195 },
    { id: 'hottest', label: 'Hottest day', day: Math.floor(hi / 24) },
  ];
}

function dateLabel(day: number) {
  const d = new Date(Date.UTC(2023, 0, 1 + day));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function HeatingLab() {
  const initial = useMemo(() => {
    const code = route.value.query.get('s');
    return (code && decodeLab(code)) || defaultLab();
  }, []);
  const [lab, setLab] = useState<LabState>(initial);
  const [active, setActive] = useState(0);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [climate, setClimate] = useState<Climate | null>(null);
  const [climateState, setClimateState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [results, setResults] = useState<(SimResult | null)[]>([]);
  const [running, setRunning] = useState(false);
  const [day, setDay] = useState<number | null>(null);
  const [hour, setHour] = useState(7);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [playing, setPlaying] = useState(!reduced);
  const [copied, setCopied] = useState(false);

  const scenario = lab.scenarios[Math.min(active, lab.scenarios.length - 1)];
  const placeKey = typeof lab.place === 'string' ? lab.place : `${lab.place.lat},${lab.place.lon},${lab.place.year}`;

  useEffect(() => {
    loadPresetIndex().then(setPresets).catch(() => setPresets([]));
  }, []);

  useEffect(() => {
    let stale = false;
    setClimateState('loading');
    const p = typeof lab.place === 'string' ? loadPreset(lab.place) : loadOpenMeteoYear(lab.place, lab.place.year);
    p.then((c) => {
      if (stale) return;
      setClimate(c);
      setClimateState('ready');
      setDay((d) => (d === null ? referenceDays(c)[0].day : d));
    }).catch(() => !stale && setClimateState('error'));
    return () => {
      stale = true;
    };
  }, [placeKey]);

  // keep the URL shareable
  useEffect(() => {
    const t = setTimeout(() => {
      const url = `#/lab/home-heating?s=${encodeLab(lab)}`;
      if (location.hash !== url) history.replaceState(null, '', url);
    }, 300);
    return () => clearTimeout(t);
  }, [lab]);

  // simulate every scenario (cached)
  const prices = { electricity: lab.money.electricity, gasPerKWh: lab.money.gasSmc / GAS_KWH_PER_SMC };
  const simKey = JSON.stringify([lab.scenarios, prices, climate?.id]);
  useEffect(() => {
    if (!climate) return;
    let stale = false;
    setRunning(true);
    const t = setTimeout(() => {
      Promise.all(lab.scenarios.map((s) => runScenario(s, climate, prices)))
        .then((rs) => {
          if (stale) return;
          setResults(rs);
          setRunning(false);
        })
        .catch(() => !stale && setRunning(false));
    }, 120);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [simKey]);

  // day playback
  useEffect(() => {
    if (!playing) return;
    // a quarter of an hour every 200 ms: smooth enough with interpolation, and the page re-renders
    // five times a second instead of every frame
    const id = setInterval(() => {
      if (!document.hidden) setHour((h) => (h + 0.25) % 24);
    }, 200);
    return () => clearInterval(id);
  }, [playing]);

  const update = (patch: Partial<Scenario>) =>
    setLab((l) => ({ ...l, scenarios: l.scenarios.map((s, i) => (i === active ? { ...s, ...patch } : s)) }));
  const setMoney = (patch: Partial<Money>) => setLab((l) => ({ ...l, money: { ...l.money, ...patch } }));
  const addScenario = () => {
    if (lab.scenarios.length >= MAX_SCENARIOS) return;
    setLab((l) => ({ ...l, scenarios: [...l.scenarios, { ...scenario, name: `${scenario.name} (copy)` }] }));
    setActive(lab.scenarios.length);
  };
  const removeScenario = () => {
    if (lab.scenarios.length <= 1) return;
    setLab((l) => ({ ...l, scenarios: l.scenarios.filter((_, i) => i !== active) }));
    setActive((a) => Math.max(0, a - 1));
  };

  const r = results[active] ?? null;
  const days = climate ? referenceDays(climate) : [];
  const d = day ?? 0;
  const tz = climate?.tz ?? 1;
  const tUtc = d * 24 + hour - tz;
  const startUtc = d * 24 - tz;

  // money for every scenario against scenario A
  const money = useMemo(() => {
    if (results.length !== lab.scenarios.length || results.some((x) => !x)) return null;
    const rs = results as SimResult[];
    const base = rs[0];
    const baseGas = base.scenario.generator === 'boiler' || base.scenario.generator === 'boiler-old';
    const items = rs.map((res, i) =>
      i === 0
        ? lab.money.boilerDueAnyway && baseGas
          ? [{ label: 'Replacement condensing boiler', eur: 3000, deductible: false, grantable: false }]
          : []
        : capexItems(res.scenario, base.scenario, res, lab.money),
    );
    return { own: rs.map((res, i) => ownership(items[i], res, lab.money)), items };
  }, [results, lab.money]);

  return (
    <div class="page lab">
      <header class="ch-head">
        <p class="kicker">
          <a href={href.challenge('home-heating')}>Heating and cooling homes without burning gas</a> · Lab
        </p>
        <h1>Home heating and cooling lab</h1>
        <p class="lede">
          An 80 m² flat, simulated hour by hour for a whole year in the place you choose. Change the insulation, the system and the way you live in it, then
          compare up to four scenarios on comfort, energy, cost and CO2.
        </p>
        <p class="lab-honest small">
          How to read it: temperatures, energy and costs come from a simplified building-physics model of the kind used for energy certificates (EN ISO 52016-1
          family). The moving air in 3D is drawn from those results to show where heat goes; it is not a fluid simulation. Prices are examples: put in your own.{' '}
          <a href="#method">Method and limits</a>
        </p>
      </header>

      <Sheet n="01" title="Place and climate" id="place">
        <PlacePicker place={lab.place} presets={presets} onChange={(p) => { setLab((l) => ({ ...l, place: p })); setDay(null); }} />
        {climateState === 'loading' && <p class="muted small" role="status">Loading the weather year…</p>}
        {climateState === 'error' && <p class="lab-warn" role="alert">The weather for this place could not be loaded. Pick a built-in city or try again.</p>}
        {climate && climateState === 'ready' && (
          <dl class="facts lab-facts" aria-label="Climate summary">
            <div><dt>Mean</dt><dd>{fmt1(annualMean(climate.t))} °C</dd></div>
            <div><dt>Design cold (99.6%)</dt><dd>{fmt1(designTemperature(climate, 0.004))} °C</dd></div>
            <div><dt>Heating degree-days</dt><dd>{fmt0(heatingDegreeDays(climate))}</dd></div>
            <div><dt>Weather</dt><dd class="small">{climate.kind === 'tmy' ? 'Typical year, PVGIS' : `${climate.year}, Open-Meteo`}</dd></div>
          </dl>
        )}
      </Sheet>

      <Sheet n="02" title="Scenarios" id="scenarios">
        <div class="lab-tabs">
          <div role="tablist" aria-label="Scenarios" class="lab-tablist">
            {lab.scenarios.map((s, i) => (
              <button key={i} role="tab" type="button" aria-selected={i === active} class={i === active ? 'is-on' : ''} onClick={() => setActive(i)}>
                <span class="lab-tab-l">{LETTERS[i]}</span> {s.name}
              </button>
            ))}
          </div>
          {lab.scenarios.length < MAX_SCENARIOS && (
            <button type="button" class="lab-tab-add" onClick={addScenario}>+ Copy as new scenario</button>
          )}
        </div>
        <div class="lab-grid">
          <form class="sim-form lab-form" onSubmit={(e) => e.preventDefault()} aria-label={`Settings for scenario ${LETTERS[active]}`}>
            <div class="sim-field">
              <label for="sc-name">Scenario name</label>
              <div class="lab-name-row">
                <input id="sc-name" value={scenario.name} maxLength={40} onInput={(e) => update({ name: (e.target as HTMLInputElement).value })} />
                {lab.scenarios.length > 1 && (
                  <button type="button" class="btn btn-ghost small" onClick={removeScenario}>Remove</button>
                )}
              </div>
            </div>
            <BuildingFields s={scenario} update={update} />
            <SystemFields s={scenario} update={update} r={r} />
            <UseFields s={scenario} update={update} />
          </form>
          <div class="lab-view">
            <Stage result={r} t={tUtc} theme={theme.value} />
            <div class="lab-player">
              <div class="segmented" role="group" aria-label="Day to show">
                {days.map((x) => (
                  <button key={x.id} type="button" class={d === x.day ? 'is-on' : ''} aria-pressed={d === x.day} onClick={() => setDay(x.day)}>{x.label}</button>
                ))}
              </div>
              <div class="lab-time">
                <button type="button" class="btn btn-ghost small" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? 'Pause' : 'Play the day'}</button>
                <label class="lab-hour">
                  <span>{dateLabel(d)}, <b>{String(Math.floor(hour)).padStart(2, '0')}:{String(Math.floor((hour % 1) * 60)).padStart(2, '0')}</b></span>
                  <input type="range" min={0} max={23.99} step={0.25} value={hour} aria-label="Hour of the day" onInput={(e) => { setPlaying(false); setHour(Number((e.target as HTMLInputElement).value)); }} />
                </label>
              </div>
              {running && <p class="muted small" role="status">Simulating…</p>}
            </div>
            {r && (
              <>
                <DayTemps r={r} start={startUtc} cursor={hour} />
                <DayPower r={r} start={startUtc} cursor={hour} />
              </>
            )}
          </div>
        </div>
      </Sheet>

      {r && (
        <Sheet n="03" title={`Scenario ${LETTERS[active]} over a year`} id="year">
          {r.warnings.length > 0 && (
            <ul class="lab-warn" role="list">
              {r.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <YearSummary r={r} money={lab.money} />
          <div class="lab-two">
            <MonthBars r={r} />
            <div>
              <p class="label">Where the heat goes</p>
              <HeatBalance r={r} />
            </div>
          </div>
          <RoomComfort r={r} />
        </Sheet>
      )}

      <Sheet n="04" title="Money" id="money">
        <MoneyFields m={lab.money} set={setMoney} />
      </Sheet>

      {money && results.every(Boolean) && (
        <Sheet n="05" title="Compare scenarios" id="compare">
          <Compare results={results as SimResult[]} own={money.own} items={money.items} active={active} money={lab.money} />
          <p class="lab-share">
            <button type="button" class="btn btn-ghost small" onClick={() => navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
              Copy a link to these scenarios
            </button>
            <span role="status" class="muted small">{copied ? 'Link copied' : ''}</span>
          </p>
        </Sheet>
      )}

      <Sheet n="06" title="Method and limits" id="method">
        <Method />
      </Sheet>
    </div>
  );
}

function PlacePicker({ place, presets, onChange }: { place: PlaceRef; presets: PresetSummary[]; onChange: (p: PlaceRef) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Place[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'none' | 'error'>('idle');
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const custom = typeof place !== 'string';
  const search = async () => {
    if (q.trim().length < 2) return;
    setState('searching');
    try {
      const res = await searchPlaces(q);
      setFound(res);
      setState(res.length ? 'idle' : 'none');
    } catch {
      setState('error');
    }
  };
  return (
    <div class="lab-place">
      <div class="sim-field">
        <label for="lab-preset">Built-in city (typical weather year)</label>
        <select id="lab-preset" value={custom ? '' : place} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
          {custom && <option value="">{place.name} ({place.year})</option>}
          {(presets.length ? presets : [{ id: 'milano', name: 'Milano', country: 'IT', zone: 'E' } as PresetSummary]).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {p.country}{p.zone ? ` · climate zone ${p.zone}` : ''}
            </option>
          ))}
        </select>
      </div>
      <form class="sim-field" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <label for="lab-search">Or any place (real weather of one year)</label>
        <div class="lab-name-row">
          <input id="lab-search" value={q} placeholder="Town or city" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <select aria-label="Weather year" value={year} onChange={(e) => setYear(Number((e.target as HTMLSelectElement).value))}>
            {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 1 - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button class="btn small" type="submit">Find</button>
        </div>
        <span class="sim-hint muted" role="status">
          {state === 'searching' ? 'Searching…' : state === 'none' ? 'No place found.' : state === 'error' ? 'Place search is not reachable right now.' : 'Weather from Open-Meteo (ERA5, CC BY 4.0), fetched by your browser.'}
        </span>
        {found.length > 0 && (
          <ul class="lab-found" role="list">
            {found.map((p) => (
              <li key={`${p.lat},${p.lon}`}>
                <button type="button" class="btn btn-ghost small" onClick={() => { onChange({ name: p.name, lat: p.lat, lon: p.lon, year }); setFound([]); }}>
                  {p.name}{p.admin ? `, ${p.admin}` : ''}{p.country ? `, ${p.country}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}

type Upd = (p: Partial<Scenario>) => void;

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: preact.ComponentChildren }) {
  return (
    <div class="sim-field">
      <label for={id}>{label}</label>
      {children}
      {hint && <span class="sim-hint muted">{hint}</span>}
    </div>
  );
}

function Num({ id, value, min, max, step, on }: { id: string; value: number; min: number; max: number; step: number; on: (v: number) => void }) {
  return <input id={id} type="number" value={value} min={min} max={max} step={step} onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) on(Math.min(max, Math.max(min, v))); }} />;
}

function BuildingFields({ s, update }: { s: Scenario; update: Upd }) {
  const preset = ENVELOPES.find((e) => e.id === s.envelopeId);
  const setEnv = (k: keyof Scenario['env'], v: number) => update({ envelopeId: 'custom', env: { ...s.env, [k]: v } });
  return (
    <fieldset>
      <legend>Building</legend>
      <Field id="f-env" label="Insulation" hint={preset ? `${preset.windowLabel}; walls U ${preset.uWall}, windows U ${preset.uWindow} W/m²K` : 'Custom values below'}>
        <select id="f-env" value={s.envelopeId} onChange={(e) => { const id = (e.target as HTMLSelectElement).value; if (id !== 'custom') update({ envelopeId: id, env: env(id) }); }}>
          {ENVELOPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom">Custom U-values</option>
        </select>
      </Field>
      <details class="sim-adv">
        <summary>U-values and air tightness</summary>
        <Field id="f-uw" label="Walls, W/m²K"><Num id="f-uw" value={s.env.uWall} min={0.1} max={3.5} step={0.01} on={(v) => setEnv('uWall', v)} /></Field>
        <Field id="f-uwin" label="Windows, W/m²K"><Num id="f-uwin" value={s.env.uWindow} min={0.6} max={6} step={0.1} on={(v) => setEnv('uWindow', v)} /></Field>
        <Field id="f-g" label="Window solar factor g"><Num id="f-g" value={s.env.gWindow} min={0.2} max={0.9} step={0.01} on={(v) => setEnv('gWindow', v)} /></Field>
        <Field id="f-ur" label="Roof, W/m²K"><Num id="f-ur" value={s.env.uRoof} min={0.1} max={3.5} step={0.01} on={(v) => setEnv('uRoof', v)} /></Field>
        <Field id="f-uf" label="Floor, W/m²K"><Num id="f-uf" value={s.env.uFloor} min={0.1} max={3.5} step={0.01} on={(v) => setEnv('uFloor', v)} /></Field>
        <Field id="f-ach" label="Air changes per hour (leaks and airing)"><Num id="f-ach" value={s.env.ach} min={0.05} max={3} step={0.05} on={(v) => setEnv('ach', v)} /></Field>
      </details>
      <Field id="f-exp" label="Position in the building">
        <select id="f-exp" value={s.exposure} onChange={(e) => update({ exposure: (e.target as HTMLSelectElement).value as Scenario['exposure'] })}>
          {EXPOSURES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </Field>
      <div class="lab-pair">
        <Field id="f-above" label="Above">
          <select id="f-above" value={s.above} onChange={(e) => update({ above: (e.target as HTMLSelectElement).value as Scenario['above'] })}>
            {ABOVE_OPTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </Field>
        <Field id="f-below" label="Below">
          <select id="f-below" value={s.below} onChange={(e) => update({ below: (e.target as HTMLSelectElement).value as Scenario['below'] })}>
            {BELOW_OPTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </Field>
      </div>
      <div class="lab-pair">
        <Field id="f-face" label="Living room faces">
          <select id="f-face" value={s.frontFacing} onChange={(e) => update({ frontFacing: Number((e.target as HTMLSelectElement).value) })}>
            {COMPASS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
          </select>
        </Field>
        <Field id="f-mass" label="Construction">
          <select id="f-mass" value={s.mass} onChange={(e) => update({ mass: (e.target as HTMLSelectElement).value as Scenario['mass'] })}>
            {Object.entries(MASS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
      </div>
      <Field id="f-vent" label="Fresh air">
        <select id="f-vent" value={s.ventilation} onChange={(e) => update({ ventilation: (e.target as HTMLSelectElement).value as Scenario['ventilation'] })}>
          <option value="natural">Opening windows</option>
          <option value="mvhr">Mechanical ventilation with heat recovery</option>
        </select>
      </Field>
      <label class="lab-check"><input type="checkbox" checked={s.shutters} onChange={(e) => update({ shutters: (e.target as HTMLInputElement).checked })} /> Close shutters on sunny summer days</label>
      <label class="lab-check"><input type="checkbox" checked={s.nightVent} onChange={(e) => update({ nightVent: (e.target as HTMLInputElement).checked })} /> Open windows on summer nights</label>
    </fieldset>
  );
}

function SystemFields({ s, update, r }: { s: Scenario; update: Upd; r: SimResult | null }) {
  const gen = generatorInfo(s.generator);
  const hp = s.generator === 'hp-air' || s.generator === 'hp-ground' || s.generator === 'hybrid';
  return (
    <fieldset>
      <legend>Heating and cooling</legend>
      <Field id="f-gen" label="Heat source">
        <select id="f-gen" value={s.generator} onChange={(e) => update({ generator: (e.target as HTMLSelectElement).value as Scenario['generator'] })}>
          {GENERATORS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </Field>
      {gen.hydronic && (
        <Field id="f-em" label="In the rooms" hint={r && r.design.designSupply ? `Needs about ${Math.round(r.design.designSupply)} °C water on the coldest days` : undefined}>
          <select id="f-em" value={s.emitter} onChange={(e) => update({ emitter: (e.target as HTMLSelectElement).value as Scenario['emitter'] })}>
            {EMITTERS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
      )}
      <Field id="f-cool" label="Summer cooling">
        <select id="f-cool" value={s.cooling} onChange={(e) => update({ cooling: (e.target as HTMLSelectElement).value as Scenario['cooling'] })}>
          <option value="none">No cooling</option>
          {gen.reversible && <option value="system">{s.generator === 'split' ? 'Yes, the same splits' : 'Yes, with the heat pump'}</option>}
          {s.generator !== 'split' && <option value="split">Add split air conditioners</option>}
        </select>
      </Field>
      <Field id="f-dhw" label="Hot water">
        <select id="f-dhw" value={s.dhw} onChange={(e) => update({ dhw: (e.target as HTMLSelectElement).value as Scenario['dhw'] })}>
          <option value="system">{gen.hydronic ? 'From the same system' : 'Electric water heater'}</option>
          <option value="hp-water-heater">Heat-pump water heater</option>
          <option value="electric">Electric water heater</option>
          <option value="gas">Gas water heater</option>
        </select>
      </Field>
      {hp && (
        <>
          <Field id="f-size" label={`Heat pump size: ${Math.round(s.hpSize * 100)}% of the design heat loss`} hint={r?.design.hpRatedW ? `Rated about ${fmt1(r.design.hpRatedW / 1000)} kW at 7 °C outside` : undefined}>
            <input id="f-size" type="range" min={0.5} max={1.5} step={0.05} value={s.hpSize} onInput={(e) => update({ hpSize: Number((e.target as HTMLInputElement).value) })} />
          </Field>
          {s.generator !== 'hybrid' && (
            <label class="lab-check"><input type="checkbox" checked={s.backup} onChange={(e) => update({ backup: (e.target as HTMLInputElement).checked })} /> Electric back-up heater for the coldest hours</label>
          )}
        </>
      )}
      <Field id="f-pv" label="Solar panels, kWp" hint="0 = none. About 5 m² of panels per kWp.">
        <Num id="f-pv" value={s.pvKwp} min={0} max={10} step={0.5} on={(v) => update({ pvKwp: v })} />
      </Field>
    </fieldset>
  );
}

function UseFields({ s, update }: { s: Scenario; update: Upd }) {
  return (
    <fieldset>
      <legend>How you live</legend>
      <div class="lab-pair">
        <Field id="f-occ" label="People"><Num id="f-occ" value={s.occupants} min={1} max={6} step={1} on={(v) => update({ occupants: Math.round(v) })} /></Field>
        <Field id="f-dhwl" label="Hot water, litres/day"><Num id="f-dhwl" value={s.dhwLitres} min={0} max={400} step={10} on={(v) => update({ dhwLitres: v })} /></Field>
      </div>
      <div class="lab-pair">
        <Field id="f-hs" label="Heating to, °C"><Num id="f-hs" value={s.heatSet} min={16} max={24} step={0.5} on={(v) => update({ heatSet: v })} /></Field>
        <Field id="f-cs" label="Cooling to, °C"><Num id="f-cs" value={s.coolSet} min={22} max={30} step={0.5} on={(v) => update({ coolSet: v })} /></Field>
      </div>
      <label class="lab-check"><input type="checkbox" checked={s.setback} onChange={(e) => update({ setback: (e.target as HTMLInputElement).checked })} /> 3 °C cooler at night (23:00–06:00)</label>
    </fieldset>
  );
}

function MoneyFields({ m, set }: { m: Money; set: (p: Partial<Money>) => void }) {
  return (
    <form class="sim-form lab-money" onSubmit={(e) => e.preventDefault()} aria-label="Prices and incentives">
      <fieldset>
        <legend>Prices <span class="small">(examples: use your own bill)</span></legend>
        <div class="lab-pair">
          <Field id="m-el" label="Electricity, €/kWh"><Num id="m-el" value={m.electricity} min={0} max={2} step={0.01} on={(v) => set({ electricity: v })} /></Field>
          <Field id="m-gas" label="Gas, €/Smc"><Num id="m-gas" value={m.gasSmc} min={0} max={5} step={0.01} on={(v) => set({ gasSmc: v })} /></Field>
        </div>
        <div class="lab-pair">
          <Field id="m-exp" label="Solar sold to the grid, €/kWh"><Num id="m-exp" value={m.exportPrice} min={0} max={1} step={0.01} on={(v) => set({ exportPrice: v })} /></Field>
          <Field id="m-fix" label="Fixed gas charges, €/year" hint="Saved if you stop using gas."><Num id="m-fix" value={m.gasFixed} min={0} max={1000} step={5} on={(v) => set({ gasFixed: v })} /></Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>Incentives and horizon</legend>
        <Field id="m-inc" label="Incentive" hint="Italy, 2026: 50% tax deduction on the main home, 36% on others, over 10 years; stand-alone gas boilers excluded. Check the current rules.">
          <select id="m-inc" value={m.incentive} onChange={(e) => set({ incentive: (e.target as HTMLSelectElement).value as Money['incentive'] })}>
            <option value="deduction50">Tax deduction 50% (main home)</option>
            <option value="deduction36">Tax deduction 36% (other homes)</option>
            <option value="grant">Grant for heat pumps (e.g. Conto Termico)</option>
            <option value="none">None</option>
          </select>
        </Field>
        {m.incentive === 'grant' && <Field id="m-grant" label="Grant, €"><Num id="m-grant" value={m.grant} min={0} max={50000} step={100} on={(v) => set({ grant: v })} /></Field>}
        <div class="lab-pair">
          <Field id="m-yrs" label="Years to compare"><Num id="m-yrs" value={m.years} min={1} max={30} step={1} on={(v) => set({ years: Math.round(v) })} /></Field>
          <Field id="m-dr" label="Discount rate, %"><Num id="m-dr" value={Math.round(m.discount * 1000) / 10} min={0} max={15} step={0.5} on={(v) => set({ discount: v / 100 })} /></Field>
        </div>
        <label class="lab-check"><input type="checkbox" checked={m.boilerDueAnyway} onChange={(e) => set({ boilerDueAnyway: (e.target as HTMLInputElement).checked })} /> Scenario A needs a new boiler anyway</label>
      </fieldset>
    </form>
  );
}

function YearSummary({ r, money }: { r: SimResult; money: Money }) {
  const t = r.totals;
  const bill = annualBill(r, money);
  const scop = seasonalCop(r);
  return (
    <dl class="facts lab-year" aria-label="Year totals">
      <div><dt>Space heating</dt><dd>{fmt0(t.spaceHeatKWh)} <small>kWh</small></dd><dd class="small muted">{fmt0(t.spaceHeatKWh / FLOOR_AREA)} kWh/m²</dd></div>
      <div><dt>Hot water</dt><dd>{fmt0(t.dhwKWh)} <small>kWh</small></dd></div>
      <div><dt>Cooling</dt><dd>{fmt0(t.coolKWh)} <small>kWh</small></dd></div>
      <div><dt>Electricity bought</dt><dd>{fmt0(t.elecGridKWh)} <small>kWh</small></dd>{t.pvKWh > 0 && <dd class="small muted">solar made {fmt0(t.pvKWh)} kWh</dd>}</div>
      <div><dt>Gas</dt><dd>{fmt0(bill.gasSmc)} <small>Smc</small></dd></div>
      {scop > 0 && <div><dt>Heat pump, seasonal COP</dt><dd>{scop.toFixed(2)}</dd></div>}
      <div><dt>Running cost</dt><dd>{eur(bill.total)} <small>/year</small></dd>{bill.pvCredit > 0 && <dd class="small muted">after {eur(bill.pvCredit)} solar savings</dd>}</div>
      <div><dt>CO2</dt><dd>{fmt0(bill.co2Kg)} <small>kg/year</small></dd></div>
    </dl>
  );
}

function RoomComfort({ r }: { r: SimResult }) {
  const c = r.comfort;
  return (
    <div class="lab-comfort">
      <p class="label">Comfort, hours per year someone is in the room</p>
      <div class="table-scroll" tabIndex={0} role="region" aria-label="Comfort by room">
        <table>
          <thead>
            <tr>
              <th scope="col">Room</th>
              <th scope="col" class="num">Too cold, h</th>
              <th scope="col" class="num">Too warm, h</th>
              <th scope="col" class="num">Coolest, °C</th>
              <th scope="col" class="num">Warmest, °C</th>
            </tr>
          </thead>
          <tbody>
            {ZONES.map((z) => {
              const p = c.perZone[z.id];
              return (
                <tr key={z.id}>
                  <th scope="row">{z.name}</th>
                  <td class="num">{fmt0(p.cold)}</td>
                  <td class="num">{fmt0(p.hot)}</td>
                  <td class="num">{fmt1(p.minOp)}</td>
                  <td class="num">{fmt1(p.maxOp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p class="small muted">
        Too cold: more than 1.5 °C below the set-point. Too warm: above the cooling set-point + 1.5 °C in air-conditioned rooms, otherwise above the adaptive
        comfort limit of EN 16798-1 (category II), which rises with the outdoor temperature of the past days. Temperatures are "feels like" (operative): the
        mean of air and surrounding surfaces.
      </p>
      <p class="small">
        On the coldest hour the inside of the windows is at <b>{fmt1(c.minWindowSurface)} °C</b> and the walls at <b>{fmt1(c.minWallSurface)} °C</b>.{' '}
        {c.minWindowSurface < c.dewPoint
          ? `Below the dew point of the room air (${fmt1(c.dewPoint)} °C at 50% humidity): expect condensation on the glass and a cold draught near the windows.`
          : c.minWindowSurface < 14
            ? 'Cold glass makes people near the windows feel a draught even when the air is warm.'
            : 'Warm enough to avoid draughts and condensation near the windows.'}
        {c.minWallSurface < 12.6 ? ' The coldest wall surface is below 12.6 °C, where mould can grow in corners (EN ISO 13788 criterion).' : ''}
      </p>
    </div>
  );
}

function Compare({ results, own, items, active, money }: { results: SimResult[]; own: ReturnType<typeof ownership>[]; items: ReturnType<typeof capexItems>[]; active: number; money: Money }) {
  const base = own[0];
  type Row = { k: string; v: (i: number) => number; f: (x: number) => string; better: 'low' | 'high' | null; note?: string };
  const rows: Row[] = [
    { k: 'Space heating, kWh/year', v: (i) => results[i].totals.spaceHeatKWh, f: fmt0, better: 'low' },
    { k: 'Electricity bought, kWh/year', v: (i) => results[i].totals.elecGridKWh, f: fmt0, better: null },
    { k: 'Gas, Smc/year', v: (i) => results[i].totals.gasKWh / GAS_KWH_PER_SMC, f: fmt0, better: null },
    { k: 'Heat pump seasonal COP', v: (i) => seasonalCop(results[i]), f: (x) => (x > 0 ? x.toFixed(2) : '–'), better: null },
    { k: 'Running cost, €/year', v: (i) => own[i].bill.total, f: eur, better: 'low', note: 'energy and servicing, minus what solar panels save on the household bill' },
    { k: 'CO2, kg/year', v: (i) => own[i].bill.co2Kg, f: fmt0, better: 'low' },
    { k: 'Hours too cold', v: (i) => results[i].comfort.coldHours, f: fmt0, better: 'low' },
    { k: 'Hours too warm', v: (i) => results[i].comfort.hotHours, f: fmt0, better: 'low' },
    { k: 'Upfront cost (example)', v: (i) => own[i].capex, f: eur, better: null },
    { k: 'Incentive', v: (i) => own[i].incentive, f: eur, better: null },
    { k: `Total cost over ${money.years} years`, v: (i) => own[i].tco, f: eur, better: 'low', note: 'present value: upfront cost minus incentives plus running costs' },
    { k: 'Pays back against A in', v: (i) => (i === 0 ? NaN : payback(own[i], base)), f: (x) => (Number.isNaN(x) ? '–' : !Number.isFinite(x) ? 'never' : x === 0 ? 'at once' : `${x.toFixed(1)} years`), better: null },
  ];
  return (
    <>
      <div class="table-scroll" tabIndex={0} role="region" aria-label="Scenario comparison">
        <table class="lab-compare">
          <caption class="sr-only">Comparison of the scenarios; the best value in each row is marked "best"</caption>
          <thead>
            <tr>
              <th scope="col">Per year unless stated</th>
              {results.map((r, i) => (
                <th key={i} scope="col" class={`num${i === active ? ' is-active' : ''}`}>
                  <span class="lab-tab-l">{LETTERS[i]}</span> {r.scenario.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const vals = results.map((_, i) => row.v(i));
              const best = row.better ? (row.better === 'low' ? Math.min(...vals) : Math.max(...vals)) : NaN;
              return (
                <tr key={row.k}>
                  <th scope="row">{row.k}{row.note && <span class="sim-hint muted"><br />{row.note}</span>}</th>
                  {vals.map((v, i) => (
                    <td key={i} class={`num${row.better && v === best && results.length > 1 ? ' is-best' : ''}`}>
                      {row.f(v)}
                      {row.better && v === best && results.length > 1 ? <span class="lab-best"> best</span> : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details class="lab-table-toggle">
        <summary>What the upfront costs include</summary>
        {items.map((list, i) =>
          i === 0 ? null : (
            <div key={i} class="lab-capex">
              <p class="label">{LETTERS[i]} · {results[i].scenario.name}</p>
              {list.length ? (
                <ul role="list">
                  {list.map((x) => (
                    <li key={x.label}><span>{x.label}</span><span class="num">{eur(x.eur)}</span></li>
                  ))}
                </ul>
              ) : (
                <p class="small muted">Nothing new to buy compared with A.</p>
              )}
            </div>
          ),
        )}
        <p class="small muted">Example installed prices including VAT, to be replaced with real quotes. Incentives only count eligible items: from 2025 a gas boiler on its own no longer qualifies.</p>
      </details>
    </>
  );
}

function Method() {
  return (
    <div class="lab-method">
      <p>
        <b>Rooms.</b> Each room is modelled as air, surfaces and heavy mass linked by heat-transfer coefficients: the "simple hourly method" of EN ISO 13790,
        carried into EN ISO 52016-1. Rooms exchange heat through partitions and open doors. Walls, windows, roof and floor lose heat according to their
        U-values; windows let the sun in according to their solar factor; people and appliances add heat on a daily profile.
      </p>
      <p>
        <b>Weather.</b> Built-in cities use a typical meteorological year from PVGIS 5.3 (EU Joint Research Centre, ERA5 and SARAH-3, 2005–2023). Other places
        use one real year from Open-Meteo's historical archive (ERA5). Sun on each wall is computed every hour from the sun's position.
      </p>
      <p>
        <b>Systems.</b> Radiators, underfloor heating and fan coils follow the standard power law of emitter output, so they need hotter water when they are
        small. Heat pump efficiency follows the Carnot limit at the actual outdoor and water temperatures, scaled to match current datasheets; air-source units
        lose capacity in the cold and some efficiency to defrosting. Condensing boilers gain efficiency when the return water is below about 55 °C. The hybrid
        picks, every hour, whichever is cheaper to run at your prices.
      </p>
      <p>
        <b>Limits.</b> Not a design tool: no thermal bridges, humidity or detailed controls, one fixed floor plan, and air movement in 3D is drawn, not solved.
        Use it to compare options and to understand what drives comfort and cost, then ask a professional for a proper heat-loss calculation (EN 12831) before
        you buy.
      </p>
      <p class="small muted">
        Sources and the full list of assumptions: <a href={href.challenge('home-heating')}>the challenge page</a>. Envelope U-values by construction period:
        TABULA Italian building typology (Politecnico di Torino, 2011). Emission factors: ISPRA. Code: <code>web/src/lib/sim/</code>.
      </p>
    </div>
  );
}
