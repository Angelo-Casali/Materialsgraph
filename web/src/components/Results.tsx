import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { CompositionResult } from '../lib/engine/composition';
import type { CoverageRow } from '../lib/engine/coverage';
import { bestValue, type ReqStatus, verdictTone } from '../lib/engine/feasibility';
import { fmtConditions, fmtRange, fmtValue, prettyProp, SOURCE_TYPE_LABEL } from '../lib/format';
import { fancy, plain } from '../lib/lexicon';
import { href } from '../lib/router';
import type { Atlas } from '../lib/snapshot';
import { CompositionBar, CoverageBars, CriticalMeter } from './Charts';
import { Formula, Seal, StatusPill } from './bits';

export interface FeasRow {
  property_type: string; unit?: string; target_min?: number | null; target_max?: number | null; importance?: string; status: ReqStatus;
  values: { value: number; unit?: string; source_type: string; confirmed: boolean; conditions?: string; source_id?: string }[];
}

const RUNE: Record<string, string> = { high: '◆◆◆', medium: '◆◆◇', low: '◆◇◇' };

export function ImportanceRune({ importance }: { importance?: string }) {
  const imp = importance ?? 'medium';
  return (
    <span class={`rune rune-${imp}`} title={`${imp} importance`}>
      <span aria-hidden="true">{RUNE[imp] ?? RUNE.medium}</span>
      <span class="rune-text">{imp}</span>
    </span>
  );
}

export function VerdictBanner({ verdict }: { verdict: string }) {
  const tone = verdictTone(verdict);
  const icon = { good: '✓', critical: '✕', warning: '!', unknown: '?' }[tone];
  return (
    <div class={`verdict verdict-${tone}`} role="status">
      <span class="verdict-icon" aria-hidden="true">{icon}</span>
      <span><strong>Verdict:</strong> {verdict}</span>
    </div>
  );
}

/** Gauge: how many high-importance requirements are met. */
export function FeasibilityGauge({ rows }: { rows: FeasRow[] }) {
  const high = rows.filter((r) => r.importance === 'high');
  const met = high.filter((r) => r.status === 'met').length;
  const n = Math.max(high.length, 1);
  const angle = (met / n) * 180;
  const rad = (Math.PI * (180 - angle)) / 180;
  const x = 60 + 46 * Math.cos(rad), y = 60 - 46 * Math.sin(rad);
  return (
    <figure class="gauge" aria-label={`${met} of ${high.length} high-importance requirements met`} role="img">
      <svg viewBox="0 0 120 70" aria-hidden="true">
        <path d="M14 60 A46 46 0 0 1 106 60" class="gauge-track" />
        {met > 0 && <path d={`M14 60 A46 46 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} class="gauge-fill" />}
        <text x="60" y="56" text-anchor="middle" class="gauge-num">{met}/{high.length}</text>
      </svg>
      <figcaption>key targets met</figcaption>
    </figure>
  );
}

export function FeasibilityTable({ rows, atlas }: { rows: FeasRow[]; atlas?: Atlas | null }) {
  return (
    <div class="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
      <table class="feas-table">
        <caption class="sr-only">Requirement-by-requirement assessment</caption>
        <thead>
          <tr><th scope="col">Requirement</th><th scope="col">Target</th><th scope="col">Importance</th><th scope="col">Evidence</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const best = r.values.length ? bestValue(r.values) : null;
            return (
              <tr key={r.property_type}>
                <th scope="row">{prettyProp(r.property_type)}</th>
                <td>{fmtRange(r.target_min, r.target_max, r.unit ?? '')}</td>
                <td><ImportanceRune importance={r.importance} /></td>
                <td>
                  {r.values.length === 0 && <span class="muted">no value in the graph</span>}
                  <ul class="evidence">
                    {r.values.map((v, i) => (
                      <li key={i} class={v === best ? 'is-best' : ''}>
                        <span class={`dot dot-${v.source_type}`} aria-hidden="true" />
                        <span>{fmtValue(v.value, v.unit ?? r.unit ?? '')}</span>
                        <span class="muted"> · {SOURCE_TYPE_LABEL[v.source_type] ?? v.source_type}</span>
                        {v.conditions && <span class="muted"> · {fmtConditions(v.conditions)}</span>}
                        <Seal confirmed={v.confirmed} size={16} />
                        {v.source_id && atlas && <span class="sr-only"> source {atlas.sources.get(v.source_id)?.title ?? v.source_id}</span>}
                      </li>
                    ))}
                  </ul>
                </td>
                <td><StatusPill status={r.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface ScreenLike { material_key: string; formula: string; energy_above_hull?: number | null; properties: { property_type: string; value: number | null; unit?: string; source_type?: string; confirmed?: boolean }[] }

export function ScreeningTable({ rows, atlas }: { rows: ScreenLike[]; atlas?: Atlas | null }) {
  if (!rows.length) return <p class="muted">No material satisfies every constraint. Loosen a constraint or remove the stability cap.</p>;
  const props = rows[0].properties.map((p) => p.property_type);
  return (
    <div class="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
      <table class="screen-table">
        <thead>
          <tr>
            <th scope="col">#</th><th scope="col">Material</th>
            {props.map((p) => <th scope="col" key={p}>{prettyProp(p)}</th>)}
            <th scope="col">E above hull</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const m = atlas?.byKey.get(r.material_key);
            return (
              <tr key={r.material_key}>
                <td class="rank">{i + 1}</td>
                <th scope="row"><a href={href.material(r.material_key)}><Formula f={r.formula} /></a>{m?.common_name && <span class="muted"> {m.common_name}</span>}</th>
                {r.properties.map((p) => (
                  <td key={p.property_type}>
                    {p.value === null ? '—' : fmtValue(p.value, p.unit ?? '')}
                    {p.source_type && <span class={`dot dot-${p.source_type}`} title={SOURCE_TYPE_LABEL[p.source_type]} />}
                    {p.confirmed === false && <span class="muted"> (pending)</span>}
                  </td>
                ))}
                <td>{r.energy_above_hull == null ? '—' : fmtValue(r.energy_above_hull, 'eV/atom')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CompositionPanel({ result, atlas }: { result: CompositionResult; atlas?: Atlas | null }) {
  return (
    <div class="comp-panel">
      <CompositionBar elements={result.elements} />
      <CriticalMeter fraction={result.critical_atom_fraction} />
      {result.critical_elements.length > 0 && (
        <p class="small">
          Critical elements:{' '}
          {result.critical_elements.map((e, i) => (
            <span key={e.symbol}>{i ? ', ' : ''}<strong>{e.symbol}</strong>{e.note ? ` (${e.note})` : ''} — {[e.eu_crm_2023 && 'EU', e.usgs_2022 && 'US'].filter(Boolean).join(' + ')}</span>
          ))}
        </p>
      )}
      {result.substitutions.length > 0 && (
        <div>
          <h3 class="h4">Single-element substitutions in the graph</h3>
          <ul class="subs">
            {result.substitutions.map((s) => (
              <li key={s.material_key}>
                <a href={href.material(s.material_key)}><Formula f={s.formula} /></a>
                <span class="muted"> — swap {s.substituted_out} → {s.substituted_in}{atlas?.byKey.get(s.material_key)?.common_name ? ` (${atlas.byKey.get(s.material_key)!.common_name})` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function GapsPanel({ coverage, gaps, sample }: { coverage: CoverageRow[]; gaps: { description: string; source_id: string; confirmed: boolean }[]; sample: boolean }) {
  return (
    <div class="gaps-panel">
      <CoverageBars rows={coverage} />
      <h3 class="h4">Documented open problems</h3>
      {gaps.length ? (
        <ul class="gap-list">
          {gaps.map((g, i) => <li key={i}><Seal confirmed={g.confirmed} size={16} /> {g.description} <span class="muted">[{g.source_id}]</span></li>)}
        </ul>
      ) : (
        <p class="muted">
          {sample
            ? 'None in the illustrative sample: gap statements come only from real papers, through the harvester and its human review gate. Inventing them for a demo would defeat the point.'
            : 'No gap statements have been accepted for this scope yet.'}
        </p>
      )}
    </div>
  );
}

export function SpellPanel({ cypher, children }: { cypher: string[]; children?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  if (!cypher.length) return null;
  const kicker = fancy('spell');
  return (
    <div class="spell">
      <button class="btn btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide' : kicker ?? 'Show'} {kicker ? `(${plain('spell').toLowerCase()})` : plain('spell').toLowerCase()}
      </button>
      {open && (
        <div class="spell-body">
          {children}
          {cypher.map((c, i) => <pre key={i}><code>{c.trim()}</code></pre>)}
        </div>
      )}
    </div>
  );
}
