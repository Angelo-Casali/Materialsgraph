import { useState } from 'preact/hooks';
import type { ElementRow } from '../lib/engine/composition';
import type { CoverageRow } from '../lib/engine/coverage';
import { prettyProp } from '../lib/format';
import { href } from '../lib/router';

/** Element fractions as one stacked bar. Identity is carried by direct labels, criticality by hatching + label (never colour alone). */
export function CompositionBar({ elements }: { elements: ElementRow[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = elements.reduce((s, e) => s + e.fraction, 0) || 1;
  const active = elements.find((e) => e.symbol === hover);
  return (
    <figure class="compbar">
      <div class="compbar-track" role="group" aria-label={`Composition by atom fraction: ${elements.map((e) => `${e.symbol} ${Math.round((100 * e.fraction) / total)}%`).join(', ')}`}>
        {elements.map((e) => {
          const pct = (100 * e.fraction) / total;
          const crit = e.eu_crm_2023 || e.usgs_2022;
          return (
            <a
              key={e.symbol}
              href={href.atlas([e.symbol])}
              class={`compbar-seg ${crit ? 'is-critical' : ''} ${hover === e.symbol ? 'is-hover' : ''}`}
              style={{ flexGrow: e.fraction }}
              onMouseEnter={() => setHover(e.symbol)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(e.symbol)}
              onBlur={() => setHover(null)}
              aria-label={`${e.symbol}: ${pct.toFixed(1)}% of atoms${crit ? ', critical raw material' : ''}. Show other materials with ${e.symbol}`}
            >
              {pct >= 7 && <span class="compbar-label">{e.symbol}</span>}
            </a>
          );
        })}
      </div>
      <figcaption class="compbar-caption">
        {active ? (
          <span>
            <strong>{active.symbol}</strong> · {((100 * active.fraction) / total).toFixed(1)}% of atoms · {active.stoichiometry} per formula unit
            {active.eu_crm_2023 && ' · EU critical'}{active.usgs_2022 && ' · US critical'}
          </span>
        ) : (
          <span class="muted">Hover or focus a segment. Hatched segments are critical raw materials.</span>
        )}
      </figcaption>
      <table class="sr-only">
        <caption>Composition</caption>
        <thead><tr><th>Element</th><th>Atoms per formula unit</th><th>Atom fraction</th><th>Critical</th></tr></thead>
        <tbody>
          {elements.map((e) => (
            <tr key={e.symbol}><td>{e.symbol}</td><td>{e.stoichiometry}</td><td>{((100 * e.fraction) / total).toFixed(1)}%</td><td>{e.eu_crm_2023 || e.usgs_2022 ? 'yes' : 'no'}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Headline meter: share of atoms that are critical raw materials. */
export function CriticalMeter({ fraction }: { fraction: number }) {
  const pct = Math.round(fraction * 100);
  return (
    <div class="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Critical raw material share of atoms">
      <div class="meter-head">
        <span class="meter-value">{pct}%</span>
        <span class="meter-label">of atoms are on a critical raw-material list</span>
      </div>
      <div class="meter-track"><div class="meter-fill hatch" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Coverage per required property, drawn as "fog" lifting: the solid part is charted, the hatched remainder is missing. */
export function CoverageBars({ rows, unitLabel = 'tagged materials' }: { rows: CoverageRow[]; unitLabel?: string }) {
  if (!rows.length) return <p class="muted">No requirement targets defined.</p>;
  return (
    <div class="coverage">
      {rows.map((r) => (
        <div class="coverage-row" key={r.property_type}>
          <span class="coverage-name">{prettyProp(r.property_type)}</span>
          <div class="coverage-track" role="img" aria-label={`${prettyProp(r.property_type)}: ${r.with_data} of ${r.total} ${unitLabel} have data (${r.coverage_pct}%)`}>
            <div class="coverage-fill" style={{ width: `${r.coverage_pct}%` }} />
          </div>
          <span class="coverage-num">{r.with_data}/{r.total}</span>
        </div>
      ))}
    </div>
  );
}
