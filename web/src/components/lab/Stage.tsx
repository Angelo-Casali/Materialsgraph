import { useEffect, useRef, useState } from 'preact/hooks';
import { ZONES, type ZoneId } from '../../lib/sim/apartment';
import type { SimResult } from '../../lib/sim/engine';
import { sunPosition } from '../../lib/sim/solar';
import { generatorInfo } from '../../lib/sim/systems';
import { TEMP_TICKS, tempCss } from '../../lib/sim/tempscale';
import type { Frame, House3D, Label } from './House3D';

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

/** Simulation values at fractional UTC hour `t` (linear interpolation between hours). */
export function frameAt(r: SimResult, t: number): Frame & { hourIndex: number } {
  const n = r.outdoor.length;
  const i0 = ((Math.floor(t) % n) + n) % n;
  const i1 = (i0 + 1) % n;
  const f = t - Math.floor(t);
  const zones = {} as Frame['zones'];
  let q = 0;
  for (const z of ZONES) {
    const s = r.zones[z.id];
    const zq = lerp(s.q[i0], s.q[i1], f);
    q += zq;
    zones[z.id] = { air: lerp(s.air[i0], s.air[i1], f), surf: lerp(s.surf[i0], s.surf[i1], f), q: zq, lossWin: lerp(s.lossWin[i0], s.lossWin[i1], f), lossOpaque: lerp(s.lossOpaque[i0], s.lossOpaque[i1], f) };
  }
  const sp = sunPosition(t, r.climate.lat, r.climate.lon);
  const el = 90 - (Math.acos(Math.max(-1, Math.min(1, sp.cosZenith))) * 180) / Math.PI;
  return {
    hourIndex: i0,
    outdoor: lerp(r.outdoor[i0], r.outdoor[i1], f),
    zones,
    mode: r.mode[f < 0.5 ? i0 : i1],
    supply: r.supply[f < 0.5 ? i0 : i1],
    load: Math.min(1, Math.abs(q) / Math.max(1500, r.design.loadW)),
    sun: el > 0 ? { az: sp.azimuth, el } : null,
  };
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface Props {
  result: SimResult | null;
  /** fractional UTC hour of the year */
  t: number;
  theme: string;
}

export function Stage({ result, t, theme }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const house = useRef<House3D | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'nowebgl' | 'error'>('loading');
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [motion, setMotion] = useState(!reduced);
  const layoutKey = result ? JSON.stringify([result.scenario, result.heated, result.cooled]) : '';

  useEffect(() => {
    let disposed = false;
    import('./House3D')
      .then((m) => {
        if (disposed || !host.current) return;
        if (!m.webglAvailable()) {
          setStatus('nowebgl');
          return;
        }
        const h = new m.House3D(host.current, colors());
        h.onLabels = setLabels;
        h.motion = motion;
        house.current = h;
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
    return () => {
      disposed = true;
      house.current?.dispose();
      house.current = null;
    };
  }, []);

  const colors = () => ({ ink: cssVar('--ink', '#111110'), ink3: cssVar('--ink-3', '#67665f'), rule: cssVar('--rule', '#d6d4cc'), bg: cssVar('--bg', '#f4f3ef'), surface: cssVar('--surface', '#fbfaf8') });

  useEffect(() => {
    if (status === 'ready' && house.current) house.current.setColors(colors());
  }, [theme, status]);

  useEffect(() => {
    if (status === 'ready' && house.current && result) house.current.setLayout({ scenario: result.scenario, heated: result.heated, cooled: result.cooled });
  }, [layoutKey, status]);

  useEffect(() => {
    if (house.current) house.current.motion = motion;
  }, [motion]);

  const frame = result ? frameAt(result, t) : null;
  useEffect(() => {
    if (status === 'ready' && house.current && frame) house.current.setFrame(frame);
  });

  const gen = result ? generatorInfo(result.scenario.generator) : null;
  const zoneName = Object.fromEntries(ZONES.map((z) => [z.id, z.name])) as Record<ZoneId, string>;
  const qTotal = frame ? Object.values(frame.zones).reduce((a, z) => a + z.q, 0) : 0;
  const hi = frame?.hourIndex ?? 0;
  const cop = result ? result.cop[hi] : 0;

  return (
    <div class="lab-stage">
      <div class="lab-canvas" ref={host}>
        {status !== 'ready' && (
          <p class="lab-canvas-msg">
            {status === 'loading' ? 'Loading the 3D view…' : status === 'nowebgl' ? 'This browser cannot show 3D (WebGL is off). Every number is still in the tables below.' : 'The 3D view failed to load. Every number is still in the tables below.'}
          </p>
        )}
        {status === 'ready' &&
          labels.map((l) =>
            l.visible && (zoneName[l.id as ZoneId] || l.text) ? (
              <span key={l.id} class={`lab-tag${zoneName[l.id as ZoneId] ? ' is-room' : ''}`} style={{ transform: `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px)` }} aria-hidden="true">
                {zoneName[l.id as ZoneId] && frame ? (
                  <>
                    {zoneName[l.id as ZoneId]}
                    <b>{fmt(0.5 * (frame.zones[l.id as ZoneId].air + frame.zones[l.id as ZoneId].surf))} °C</b>
                  </>
                ) : (
                  l.text
                )}
              </span>
            ) : null,
          )}
      </div>
      <div class="lab-stage-bar">
        <TempLegend />
        <label class="lab-check">
          <input type="checkbox" checked={motion} onChange={(e) => setMotion((e.target as HTMLInputElement).checked)} /> Moving air
        </label>
        <div class="segmented" role="group" aria-label="Camera">
          <button type="button" onClick={() => house.current?.view('left')} aria-label="Turn the view left">⟲</button>
          <button type="button" onClick={() => house.current?.view('reset')}>Front</button>
          <button type="button" onClick={() => house.current?.view('top')}>Plan</button>
          <button type="button" onClick={() => house.current?.view('right')} aria-label="Turn the view right">⟳</button>
        </div>
      </div>
      {frame && result && (
        <div class="lab-readout" aria-live="off">
          <p class="lab-readout-head">
            <span>Outside <b>{fmt(frame.outdoor)} °C</b></span>
            <span>{frame.mode === 1 ? 'Heating' : frame.mode === -1 ? 'Cooling' : 'System idle'}{frame.mode !== 0 ? <> · <b>{fmt(Math.abs(qTotal) / 1000, 2)} kW</b></> : null}</span>
            {frame.mode !== 0 && frame.supply > 0 && <span>Water <b>{fmt(frame.supply, 0)} °C</b></span>}
            {frame.mode !== 0 && cop > 0 && gen && (
              <span>
                {gen.fuel === 'gas' ? 'Efficiency' : frame.mode === -1 ? 'EER' : 'COP'} <b>{gen.fuel === 'gas' ? `${Math.round(cop * 100)}%` : fmt(cop, 1)}</b>
              </span>
            )}
            <span>{frame.sun ? `Sun ${Math.round(frame.sun.el)}° up` : 'Night'}</span>
          </p>
          <div class="table-scroll" tabIndex={0} role="region" aria-label="Room readout">
            <table class="lab-rooms">
              <caption class="sr-only">Room temperatures and heat delivered at the selected hour (negative heat means cooling)</caption>
              <thead>
                <tr>
                  <th scope="col">Room</th>
                  <th scope="col" class="num">Air °C</th>
                  <th scope="col" class="num">Feels like °C</th>
                  <th scope="col" class="num">Heat in, W</th>
                </tr>
              </thead>
              <tbody>
                {ZONES.map((z) => {
                  const zf = frame.zones[z.id];
                  const op = 0.5 * (zf.air + zf.surf);
                  return (
                    <tr key={z.id}>
                      <th scope="row">
                        <i class="lab-sw" style={{ background: tempCss(op) }} aria-hidden="true" /> {z.name}
                      </th>
                      <td class="num">{fmt(zf.air)}</td>
                      <td class="num">{fmt(op)}</td>
                      <td class="num">{Math.abs(zf.q) < 5 ? '0' : Math.round(zf.q)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function TempLegend() {
  return (
    <div class="lab-legend" role="img" aria-label="Colour scale: blue is cold, grey about 21 degrees, red is hot">
      <span class="lab-legend-title">°C</span>
      {TEMP_TICKS.map((t) => (
        <span key={t} class="lab-legend-step">
          <i style={{ background: tempCss(t) }} />
          {t}
        </span>
      ))}
    </div>
  );
}
