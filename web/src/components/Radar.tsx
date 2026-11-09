import { RINGS, type Ring, type Technology } from '../lib/challenges/types';

const SIZE = 360;
const C = SIZE / 2;
/** outer radius of each ring, inner to outer */
const RADII: Record<Ring, [number, number]> = { adopt: [0, 56], trial: [56, 100], assess: [100, 140], hold: [140, 178] };

/** Deterministic blip positions: spread each ring's technologies over the upper half-circle, labels below. */
export function blipPositions(techs: Technology[]): Map<string, { x: number; y: number; n: number }> {
  const out = new Map<string, { x: number; y: number; n: number }>();
  let n = 0;
  for (const ring of RINGS) {
    const inRing = techs.filter((t) => t.ring === ring.id);
    const [r0, r1] = RADII[ring.id];
    const r = ring.id === 'adopt' ? 32 : (r0 + r1) / 2;
    inRing.forEach((t, i) => {
      // angles from 200° to 340° (top half), evenly spaced; a single blip sits at the top
      const a = inRing.length === 1 ? 270 : 200 + (140 * i) / (inRing.length - 1);
      const rad = (a * Math.PI) / 180;
      out.set(t.id, { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad), n: ++n });
    });
  }
  return out;
}

export function Radar({ techs, selected, onSelect }: { techs: Technology[]; selected: string | null; onSelect: (id: string) => void }) {
  const pos = blipPositions(techs);
  const desc = RINGS.map((r) => `${r.label}: ${techs.filter((t) => t.ring === r.id).map((t) => t.name).join(', ') || 'none'}`).join('. ');
  return (
    <div class="radar-wrap">
      <svg class="radar" viewBox={`0 0 ${SIZE} ${SIZE / 2 + 24}`} role="img" aria-labelledby="radar-t radar-d">
        <title id="radar-t">Technology radar</title>
        <desc id="radar-d">{desc}</desc>
        {[...RINGS].reverse().map((r) => (
          <path
            key={r.id}
            class={`radar-ring radar-ring-${r.id}`}
            d={`M ${C - RADII[r.id][1]} ${C} A ${RADII[r.id][1]} ${RADII[r.id][1]} 0 0 1 ${C + RADII[r.id][1]} ${C} Z`}
          />
        ))}
        {RINGS.map((r) => (
          <text key={r.id} class="radar-label" x={C + (RADII[r.id][0] + RADII[r.id][1]) / 2} y={C + 16} text-anchor="middle">{r.label}</text>
        ))}
        {techs.map((t) => {
          const p = pos.get(t.id)!;
          const on = selected === t.id;
          return (
            <g key={t.id} class={`radar-blip blip-${t.ring} ${on ? 'is-on' : ''}`} onClick={() => onSelect(t.id)}>
              <circle cx={p.x} cy={p.y} r={on ? 13 : 11} />
              <text x={p.x} y={p.y + 4} text-anchor="middle">{p.n}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
