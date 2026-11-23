import { RINGS, type Ring, type Technology } from '../lib/challenges/types';

const SIZE = 360;
const C = SIZE / 2;
/** outer radius of each ring, inner to outer */
const RADII: Record<Ring, [number, number]> = { adopt: [0, 72], trial: [72, 114], assess: [114, 146], hold: [146, 178] };

/** Rows of blips per ring (outer row first) so crowded rings stay readable. */
const ROWS: Record<Ring, number[]> = { adopt: [58, 34], trial: [103, 83], assess: [130, 130], hold: [162, 162] };
const ARC = (140 * Math.PI) / 180;
const MIN_GAP = 24;

/** Deterministic blip positions: spread each ring's technologies over the upper half-circle, labels below. */
export function blipPositions(techs: Technology[]): Map<string, { x: number; y: number; n: number }> {
  const out = new Map<string, { x: number; y: number; n: number }>();
  let n = 0;
  for (const ring of RINGS) {
    const inRing = techs.filter((t) => t.ring === ring.id);
    const [outer, inner] = ROWS[ring.id];
    const capOuter = Math.floor((outer * ARC) / MIN_GAP) + 1;
    const rows = inRing.length <= 1 ? [inRing] : inRing.length <= capOuter && inRing.length <= 4 ? [inRing] : [inRing.slice(0, Math.ceil(inRing.length / 2)), inRing.slice(Math.ceil(inRing.length / 2))];
    rows.forEach((row, ri) => {
      const r = rows.length === 1 ? (ring.id === 'adopt' ? 46 : (outer + inner) / 2) : ri === 0 ? outer : inner;
      row.forEach((t, i) => {
        // angles from 200° to 340° (top half), evenly spaced; the inner row is offset by half a step
        const step = row.length > 1 ? 140 / (row.length - 1) : 0;
        const a = row.length === 1 ? 270 : rows.length > 1 && ri === 1 ? 200 + step / 2 + ((140 - step) * i) / Math.max(1, row.length - 1) : 200 + step * i;
        const rad = (a * Math.PI) / 180;
        out.set(t.id, { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad), n: ++n });
      });
    });
  }
  return out;
}

export function Radar({ techs, selected, onSelect }: { techs: Technology[]; selected: string | null; onSelect: (id: string) => void }) {
  const pos = blipPositions(techs);
  const desc = RINGS.map((r) => `${r.label}: ${techs.filter((t) => t.ring === r.id).map((t) => t.name).join(', ') || 'none'}`).join('. ');
  return (
    <div class="radar-wrap">
      <svg class="radar" viewBox={`0 0 ${SIZE} ${SIZE / 2 + 34}`} role="img" aria-labelledby="radar-t radar-d">
        <title id="radar-t">Technology radar</title>
        <desc id="radar-d">{desc}</desc>
        {[...RINGS].reverse().map((r) => (
          <path
            key={r.id}
            class={`radar-ring radar-ring-${r.id}`}
            d={`M ${C - RADII[r.id][1]} ${C} A ${RADII[r.id][1]} ${RADII[r.id][1]} 0 0 1 ${C + RADII[r.id][1]} ${C} Z`}
          />
        ))}
        {RINGS.map((r, i) => (
          // narrow outer rings: stagger the labels on two lines so they never overlap
          <text key={r.id} class="radar-label" x={C + (RADII[r.id][0] + RADII[r.id][1]) / 2} y={C + (i % 2 ? 30 : 16)} text-anchor="middle">{r.label}</text>
        ))}
        {techs.map((t) => {
          const p = pos.get(t.id)!;
          const on = selected === t.id;
          return (
            <g key={t.id} class={`radar-blip blip-${t.ring} ${on ? 'is-on' : ''}`} onClick={() => onSelect(t.id)}>
              <circle cx={p.x} cy={p.y} r={on ? 11 : 9.5} />
              <text x={p.x} y={p.y + 4} text-anchor="middle">{p.n}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
