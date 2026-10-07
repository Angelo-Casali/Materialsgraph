import type { Atlas } from '../lib/snapshot';
import { displayName } from '../lib/snapshot';
import { href } from '../lib/router';
import type { Material } from '../lib/types';

interface Node { id: string; label: string; kind: 'center' | 'element' | 'application' | 'material'; link: string; confirmed: boolean; x: number; y: number; title: string }

/** Radial neighbourhood: elements on the inner orbit, applications and similar materials on the outer orbit.
 *  Dashed edges = not yet confirmed by a human. A plain list follows the drawing for screen readers and small screens. */
export function Constellation({ atlas, m }: { atlas: Atlas; m: Material }) {
  const W = 560, H = 380, cx = W / 2, cy = H / 2;
  const inner = m.composition.map((c, i, arr) => {
    const a = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
    return { id: `el:${c.symbol}`, label: c.symbol, kind: 'element' as const, link: href.atlas([c.symbol]), confirmed: true, x: cx + Math.cos(a) * 92, y: cy + Math.sin(a) * 92, title: `${c.symbol}: ${c.stoichiometry} per formula unit` };
  });
  const outerItems = [
    ...m.used_in.map((u) => ({ id: `app:${u.application}`, label: u.application, kind: 'application' as const, link: href.quest(u.application, m.key), confirmed: u.confirmed, title: `${u.application} (${u.basis}${u.confirmed ? '' : ', awaiting review'})` })),
    ...m.similar.map((s) => {
      const o = atlas.byKey.get(s.key);
      return { id: `m:${s.key}`, label: o ? displayName(o) : s.key, kind: 'material' as const, link: href.material(s.key), confirmed: s.confirmed, title: `Similar composition (${s.method}, score ${s.score.toFixed(2)}${s.confirmed ? '' : ', machine suggestion awaiting review'})` };
    }),
  ];
  const outer: Node[] = outerItems.map((n, i, arr) => {
    const a = (i / Math.max(arr.length, 1)) * Math.PI * 2 - Math.PI / 2 + Math.PI / Math.max(arr.length, 1);
    return { ...n, x: cx + Math.cos(a) * 165, y: cy + Math.sin(a) * 150 };
  });

  return (
    <figure class="constellation">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-labelledby="constellation-title">
        <title id="constellation-title">{`Neighbourhood of ${m.formula}: ${inner.length} elements, ${m.used_in.length} applications, ${m.similar.length} similar materials`}</title>
        <circle cx={cx} cy={cy} r={92} class="orbit" />
        <ellipse cx={cx} cy={cy} rx={165} ry={150} class="orbit" />
        {inner.map((n) => <line key={`l-${n.id}`} x1={cx} y1={cy} x2={n.x} y2={n.y} class="edge edge-composed" />)}
        {outer.map((n) => <line key={`l-${n.id}`} x1={cx} y1={cy} x2={n.x} y2={n.y} class={`edge edge-${n.kind} ${n.confirmed ? '' : 'is-pending'}`} />)}
        <g class="node node-center">
          <circle cx={cx} cy={cy} r={34} />
          <text x={cx} y={cy + 5} text-anchor="middle">{(m.common_name ?? m.formula).slice(0, 10)}</text>
        </g>
        {[...inner, ...outer].map((n) => (
          <a key={n.id} href={n.link} class={`node node-${n.kind} ${n.confirmed ? '' : 'is-pending'}`}>
            <title>{n.title}</title>
            {n.kind === 'element' ? <circle cx={n.x} cy={n.y} r={18} /> : <rect x={n.x - 58} y={n.y - 14} width={116} height={28} rx={14} />}
            <text x={n.x} y={n.y + 4.5} text-anchor="middle">{n.label.length > 17 ? `${n.label.slice(0, 16)}…` : n.label}</text>
          </a>
        ))}
      </svg>
      <figcaption>
        <span class="legend-inline"><span class="edge-key" /> confirmed link</span>
        <span class="legend-inline"><span class="edge-key is-pending" /> awaiting review</span>
      </figcaption>
      <details class="constellation-list">
        <summary>Show as a list</summary>
        <ul>
          {inner.map((n) => <li key={n.id}><a href={n.link}>Element {n.label}</a> — {n.title}</li>)}
          {outer.map((n) => <li key={n.id}><a href={n.link}>{n.label}</a> — {n.title}</li>)}
        </ul>
      </details>
    </figure>
  );
}
