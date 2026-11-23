/**
 * Charts for the heating lab, hand-drawn SVG in the datasheet style: one axis per chart, thin marks,
 * recessive grid, direct labels, and a table view next to every chart.
 */
import type { SimResult } from '../../lib/sim/engine';

const fmt0 = (x: number) => Math.round(x).toLocaleString('en-GB');
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function scale(d0: number, d1: number, r0: number, r1: number) {
  return (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
}

/** Push end-of-line labels apart so they never overlap (min gap in px). */
function spread(ys: number[], gap = 12): number[] {
  const idx = ys.map((y, i) => [y, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < idx.length; k++) if (idx[k][0] - idx[k - 1][0] < gap) idx[k][0] = idx[k - 1][0] + gap;
  const out: number[] = [];
  for (const [y, i] of idx) out[i] = y;
  return out;
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

interface DayProps {
  r: SimResult;
  /** first UTC hour of the local day */
  start: number;
  /** current local hour (fractional) for the cursor */
  cursor: number;
}

/** Temperatures through the selected day: outside, living room and bedroom (operative). */
export function DayTemps({ r, start, cursor }: DayProps) {
  const W = 560;
  const H = 190;
  const m = { l: 34, r: 74, t: 10, b: 24 };
  const series = [
    { key: 'Outside', vals: Array.from({ length: 25 }, (_, h) => r.outdoor[(start + h) % r.outdoor.length]), dash: '4 3', w: 1.5 },
    { key: 'Living room', vals: Array.from({ length: 25 }, (_, h) => r.zones.living.op[(start + h) % r.outdoor.length]), dash: '', w: 2 },
    { key: 'Bedroom 1', vals: Array.from({ length: 25 }, (_, h) => r.zones.bed1.op[(start + h) % r.outdoor.length]), dash: '1 3', w: 2 },
  ];
  const all = series.flatMap((s) => s.vals);
  const lo = Math.floor(Math.min(...all, r.scenario.heatSet - 4) / 5) * 5;
  const hi = Math.ceil(Math.max(...all, r.scenario.heatSet + 2) / 5) * 5;
  const x = scale(0, 24, m.l, W - m.r);
  const y = scale(lo, hi, H - m.b, m.t);
  const path = (v: number[]) => v.map((t, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(t).toFixed(1)}`).join('');
  const ly = spread(series.map((s) => y(s.vals[24]) + 4));
  return (
    <figure class="lab-chart">
      <figcaption>Temperature through the day, °C (rooms: how warm it feels)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Temperatures through the day. Outside from ${Math.min(...series[0].vals).toFixed(1)} to ${Math.max(...series[0].vals).toFixed(1)} °C; living room from ${Math.min(...series[1].vals).toFixed(1)} to ${Math.max(...series[1].vals).toFixed(1)} °C.`}>
        {niceTicks(lo, hi).map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} class="grid" />
            <text x={m.l - 6} y={y(t) + 4} text-anchor="end" class="tick">{t}</text>
          </g>
        ))}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x(h)} y={H - 6} text-anchor="middle" class="tick">{String(h).padStart(2, '0')}:00</text>
        ))}
        {series.map((s, i) => (
          <g key={s.key}>
            <path d={path(s.vals)} fill="none" stroke="currentColor" stroke-width={s.w} stroke-dasharray={s.dash} />
            <text x={W - m.r + 6} y={ly[i]} class="lbl">{s.key}</text>
          </g>
        ))}
        <line x1={x(cursor)} x2={x(cursor)} y1={m.t} y2={H - m.b} class="cursor" />
      </svg>
    </figure>
  );
}

/** Heat delivered and electricity drawn through the day, kW. */
export function DayPower({ r, start, cursor }: DayProps) {
  const W = 560;
  const H = 150;
  const m = { l: 34, r: 74, t: 10, b: 24 };
  const n = r.outdoor.length;
  const heat = Array.from({ length: 24 }, (_, h) => {
    let q = 0;
    for (const z of Object.values(r.zones)) q += z.q[(start + h) % n];
    return q / 1000;
  });
  const elec = Array.from({ length: 24 }, (_, h) => r.elecW[(start + h) % n] / 1000);
  const gas = Array.from({ length: 24 }, (_, h) => r.gasW[(start + h) % n] / 1000);
  const hasGas = gas.some((g) => g > 0.01);
  const lo = Math.min(0, ...heat);
  const hi = Math.max(0.5, ...heat.map(Math.abs), ...elec, ...gas);
  const x = scale(0, 24, m.l, W - m.r);
  const y = scale(lo, hi, H - m.b, m.t);
  const bw = (W - m.l - m.r) / 24 - 3;
  const [lyE, lyG] = spread([y(elec[23]) + 4, y(gas[23]) + 4]);
  const line = (v: number[]) => v.map((t, h) => `${h ? 'L' : 'M'}${(x(h) + bw / 2 + 1.5).toFixed(1)},${y(t).toFixed(1)}`).join('');
  return (
    <figure class="lab-chart">
      <figcaption>Heat delivered (bars, negative = cooling) and energy bought (lines), kW</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Heat delivered peaks at ${Math.max(...heat).toFixed(1)} kW; electricity peaks at ${Math.max(...elec).toFixed(1)} kW${hasGas ? `; gas peaks at ${Math.max(...gas).toFixed(1)} kW` : ''}.`}>
        {niceTicks(lo, hi, 3).map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} class={t === 0 ? 'axis' : 'grid'} />
            <text x={m.l - 6} y={y(t) + 4} text-anchor="end" class="tick">{t}</text>
          </g>
        ))}
        {heat.map((q, h) => (
          <rect key={h} x={x(h) + 1.5} width={bw} y={Math.min(y(q), y(0))} height={Math.abs(y(q) - y(0))} class="bar" />
        ))}
        <path d={line(elec)} fill="none" stroke="currentColor" stroke-width="2" />
        <text x={W - m.r + 6} y={hasGas ? lyE : y(elec[23]) + 4} class="lbl">Electricity</text>
        {hasGas && (
          <>
            <path d={line(gas)} fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" />
            <text x={W - m.r + 6} y={lyG} class="lbl">Gas</text>
          </>
        )}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x(h)} y={H - 6} text-anchor="middle" class="tick">{String(h).padStart(2, '0')}:00</text>
        ))}
        <line x1={x(cursor)} x2={x(cursor)} y1={m.t} y2={H - m.b} class="cursor" />
      </svg>
    </figure>
  );
}

/** Monthly heating and cooling delivered (kWh) with a table view. */
export function MonthBars({ r }: { r: SimResult }) {
  const W = 560;
  const H = 170;
  const m = { l: 44, r: 8, t: 10, b: 22 };
  const heat = r.monthly.map((x) => x.heat);
  const cool = r.monthly.map((x) => -x.cool);
  const hi = Math.max(10, ...heat);
  const lo = Math.min(0, ...cool);
  const x = scale(0, 12, m.l, W - m.r);
  const y = scale(lo, hi, H - m.b, m.t);
  const bw = (W - m.l - m.r) / 12 - 6;
  return (
    <figure class="lab-chart">
      <figcaption>Heat delivered each month, kWh (below the line: cooling)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Monthly heating peaks at ${fmt0(Math.max(...heat))} kWh; yearly heating ${fmt0(r.totals.spaceHeatKWh)} kWh, cooling ${fmt0(r.totals.coolKWh)} kWh.`}>
        {niceTicks(lo, hi, 3).map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} class={t === 0 ? 'axis' : 'grid'} />
            <text x={m.l - 6} y={y(t) + 4} text-anchor="end" class="tick">{fmt0(Math.abs(t))}</text>
          </g>
        ))}
        {heat.map((v, i) => (
          <rect key={`h${i}`} x={x(i) + 3} width={bw} y={y(v)} height={Math.max(0, y(0) - y(v))} class="bar" />
        ))}
        {cool.map((v, i) => (v < 0 ? <rect key={`c${i}`} x={x(i) + 3} width={bw} y={y(0)} height={Math.max(0, y(v) - y(0))} class="bar bar-hatch" /> : null))}
        {MONTHS.map((l, i) => (
          <text key={i} x={x(i) + 3 + bw / 2} y={H - 6} text-anchor="middle" class="tick">{l}</text>
        ))}
      </svg>
      <details class="lab-table-toggle">
        <summary>Table</summary>
        <div class="table-scroll" tabIndex={0} role="region" aria-label="Monthly energy table">
          <table>
            <thead>
              <tr><th scope="col">Month</th><th scope="col" class="num">Heating kWh</th><th scope="col" class="num">Cooling kWh</th><th scope="col" class="num">Electricity kWh</th><th scope="col" class="num">Gas kWh</th></tr>
            </thead>
            <tbody>
              {r.monthly.map((mo, i) => (
                <tr key={i}><th scope="row">{MONTHS_LONG[i]}</th><td class="num">{fmt0(mo.heat)}</td><td class="num">{fmt0(mo.cool)}</td><td class="num">{fmt0(mo.elec)}</td><td class="num">{fmt0(mo.gas)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Where the heat goes in the hours the system heats, and what covers it. */
export function HeatBalance({ r }: { r: SimResult }) {
  const b = r.balance;
  const out = [
    ['Windows', b.windows],
    ['Walls', b.walls],
    ['Roof', b.roof],
    ['Floor', b.floor],
    ['Fresh air and leaks', b.ventilation],
  ].filter(([, v]) => (v as number) > 0.5) as [string, number][];
  const inn = [
    ['Heating system', b.heating],
    ['Sun through windows and on walls', b.solar],
    ['People and appliances', b.internal],
  ].filter(([, v]) => (v as number) > 0.5) as [string, number][];
  const max = Math.max(1, ...out.map((o) => o[1]), ...inn.map((o) => o[1]));
  const row = ([k, v]: [string, number]) => (
    <li key={k}>
      <span class="lab-bal-k">{k}</span>
      <span class="lab-bal-bar" aria-hidden="true"><i style={{ width: `${(v / max) * 100}%` }} /></span>
      <span class="lab-bal-v">{fmt0(v)} kWh</span>
    </li>
  );
  return (
    <div class="lab-balance">
      <div>
        <p class="label">Heat lost while heating</p>
        <ul role="list">{out.map(row)}</ul>
      </div>
      <div>
        <p class="label">Covered by</p>
        <ul role="list">{inn.map(row)}</ul>
      </div>
    </div>
  );
}
