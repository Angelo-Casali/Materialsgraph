import { useMemo, useRef, useState } from 'preact/hooks';
import { elementFog } from '../lib/engine/coverage';
import type { Atlas } from '../lib/snapshot';
import { PERIODIC, type PeriodicElement } from '../data/periodic';

export type Overlay = 'materials' | 'criticality' | 'fog' | 'none';

/** Sequential step (100..650) for a material count; 0 -> uncharted. */
export function countStep(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 150;
  if (n === 2) return 250;
  if (n <= 4) return 350;
  if (n <= 7) return 450;
  if (n <= 12) return 550;
  return 650;
}

interface Props {
  atlas: Atlas;
  overlay: Overlay;
  fogProperty: string;
  selected: string[];
  onToggle: (symbol: string) => void;
  onInspect?: (el: PeriodicElement | null) => void;
}

const ROWS = 10;

export function PeriodicTable({ atlas, overlay, fogProperty, selected, onToggle, onInspect }: Props) {
  const fog = useMemo(() => (overlay === 'fog' ? elementFog(atlas, fogProperty) : null), [atlas, overlay, fogProperty]);
  const [focusSym, setFocusSym] = useState<string>('Li');
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const byRow = useMemo(() => {
    const rows: PeriodicElement[][] = Array.from({ length: ROWS }, () => []);
    for (const e of PERIODIC) rows[e.row - 1].push(e);
    rows.forEach((r) => r.sort((a, b) => a.col - b.col));
    return rows;
  }, []);

  function move(from: PeriodicElement, dRow: number, dCol: number) {
    // nearest element in the requested direction, skipping the empty cells of the table
    let best: PeriodicElement | null = null;
    let bestScore = Infinity;
    for (const e of PERIODIC) {
      const dr = e.row - from.row;
      const dc = e.col - from.col;
      if (dRow && Math.sign(dr) !== dRow) continue;
      if (dCol && Math.sign(dc) !== dCol) continue;
      if (dRow && dr === 0) continue;
      if (dCol && dc === 0) continue;
      const score = dRow ? Math.abs(dr) * 100 + Math.abs(dc) : Math.abs(dc) * 100 + Math.abs(dr) * 1000;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      setFocusSym(best.symbol);
      refs.current[best.symbol]?.focus();
      onInspect?.(best);
    }
  }

  function onKey(e: KeyboardEvent, el: PeriodicElement) {
    const map: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (map[e.key]) {
      e.preventDefault();
      move(el, ...map[e.key]);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const row = byRow[el.row - 1];
      const target = e.key === 'Home' ? row[0] : row[row.length - 1];
      setFocusSym(target.symbol);
      refs.current[target.symbol]?.focus();
    }
  }

  return (
    <div class={`ptable overlay-${overlay}`} role="grid" aria-label="Periodic table. Arrow keys move, Enter or Space selects an element." aria-multiselectable="true">
      {byRow.map((row, ri) => row.length === 0 ? null : (
        <div role="row" class="ptable-row" key={ri} aria-rowindex={ri + 1}>
          {row.map((el) => {
            const mats = atlas.byElement.get(el.symbol) ?? [];
            const flags = atlas.flags.get(el.symbol);
            const critical = !!(flags?.eu_crm_2023 || flags?.usgs_2022);
            const isSel = selected.includes(el.symbol);
            const f = fog?.get(el.symbol);
            const fogOpacity = overlay === 'fog' ? (f && f.coverage !== null ? 1 - f.coverage : 1) : 0;
            const step = overlay === 'materials' ? countStep(mats.length) : 0;
            const parts = [`${el.symbol}, ${el.name}`, `${mats.length} material${mats.length === 1 ? '' : 's'}`];
            if (flags?.eu_crm_2023) parts.push('EU critical raw material');
            if (flags?.usgs_2022) parts.push('US critical mineral');
            if (overlay === 'fog') parts.push(f && f.coverage !== null ? `${Math.round(f.coverage * 100)}% have ${fogProperty.replace(/_/g, ' ')} data` : 'uncharted');
            if (isSel) parts.push('selected');
            return (
              <div role="gridcell" key={el.symbol} class="ptable-cell" style={{ gridRow: el.row >= 9 ? el.row + 1 : el.row, gridColumn: el.col }} aria-selected={isSel}>
                <button
                  ref={(r) => { refs.current[el.symbol] = r; }}
                  type="button"
                  class={`tile block-${el.block} ${mats.length ? 'has-mats' : 'no-mats'} ${isSel ? 'is-selected' : ''} ${critical ? 'is-critical' : ''} ${step ? `heat-${step}` : ''}`}
                  tabIndex={el.symbol === focusSym ? 0 : -1}
                  aria-label={parts.join(', ')}
                  aria-pressed={isSel}
                  onClick={() => { setFocusSym(el.symbol); onToggle(el.symbol); }}
                  onKeyDown={(e) => onKey(e as unknown as KeyboardEvent, el)}
                  onFocus={() => onInspect?.(el)}
                  onMouseEnter={() => onInspect?.(el)}
                >
                  <span class="tile-z" aria-hidden="true">{el.z}</span>
                  <span class="tile-sym" aria-hidden="true">{el.symbol}</span>
                  {mats.length > 0 && overlay !== 'none' && overlay !== 'criticality' && (
                    <span class="tile-count" aria-hidden="true">{overlay === 'fog' && f && f.coverage !== null ? `${Math.round(f.coverage * 100)}%` : mats.length}</span>
                  )}
                  {overlay === 'criticality' && critical && (
                    <span class="tile-flags" aria-hidden="true">
                      {flags?.eu_crm_2023 && <span class="flag flag-eu">EU</span>}
                      {flags?.usgs_2022 && <span class="flag flag-us">US</span>}
                    </span>
                  )}
                  {overlay === 'fog' && <span class="tile-fog" style={{ opacity: fogOpacity }} aria-hidden="true" />}
                </button>
              </div>
            );
          })}
        </div>
      ))}
      <div class="ptable-fblock-label" style={{ gridRow: 10, gridColumn: '1 / 3' }} aria-hidden="true">La–Lu</div>
      <div class="ptable-fblock-label" style={{ gridRow: 11, gridColumn: '1 / 3' }} aria-hidden="true">Ac–Lr</div>
    </div>
  );
}

export function OverlayLegend({ overlay, fogProperty }: { overlay: Overlay; fogProperty: string }) {
  if (overlay === 'materials') {
    const steps: [number, string][] = [[150, '1'], [250, '2'], [350, '3–4'], [450, '5–7'], [550, '8–12'], [650, '13+']];
    return (
      <div class="legend" aria-label="Legend: number of materials containing the element">
        <span class="legend-title">Materials containing the element</span>
        <span class="legend-swatch heat-0" />
        <span class="legend-label">none</span>
        {steps.map(([s, l]) => (
          <span key={s} class="legend-item"><span class={`legend-swatch heat-${s}`} /><span class="legend-label">{l}</span></span>
        ))}
      </div>
    );
  }
  if (overlay === 'criticality') {
    return (
      <div class="legend">
        <span class="legend-title">Critical raw materials</span>
        <span class="legend-item"><span class="flag flag-eu">EU</span><span class="legend-label">EU CRM list 2023</span></span>
        <span class="legend-item"><span class="flag flag-us">US</span><span class="legend-label">USGS critical minerals 2022</span></span>
        <span class="legend-item"><span class="legend-swatch hatch" /><span class="legend-label">on at least one list</span></span>
      </div>
    );
  }
  if (overlay === 'fog') {
    return (
      <div class="legend">
        <span class="legend-title">Share of materials with {fogProperty.replace(/_/g, ' ')} data</span>
        <span class="legend-item"><span class="legend-swatch fog-0" /><span class="legend-label">all charted</span></span>
        <span class="legend-item"><span class="legend-swatch fog-50" /><span class="legend-label">half</span></span>
        <span class="legend-item"><span class="legend-swatch fog-100" /><span class="legend-label">no data / uncharted</span></span>
      </div>
    );
  }
  return null;
}

