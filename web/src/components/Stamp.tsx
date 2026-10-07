import { useState } from 'preact/hooks';
import { fmtConditions, fmtValue, prettyProp, SOURCE_TYPE_LABEL } from '../lib/format';
import type { PropertyValue } from '../lib/types';
import { Seal } from './bits';

/** Shape carries the source type independently of colour: circle = measured, hexagon = DFT, diamond = ML potential, rectangle = literature. */
function StampShape({ type }: { type: PropertyValue['source_type'] }) {
  const common = { class: 'stamp-shape', 'vector-effect': 'non-scaling-stroke' } as const;
  if (type === 'measured') return <circle cx="50" cy="50" r="44" {...common} />;
  if (type === 'dft') return <polygon points="50,5 89,27.5 89,72.5 50,95 11,72.5 11,27.5" {...common} />;
  if (type === 'mlip_predicted') return <polygon points="50,4 96,50 50,96 4,50" {...common} />;
  return <rect x="6" y="16" width="88" height="68" rx="6" {...common} />;
}

export function Stamp({ pv, sample, sourceTitle }: { pv: PropertyValue; sample: boolean; sourceTitle?: string }) {
  const [open, setOpen] = useState(false);
  const cond = fmtConditions(pv.conditions);
  const id = `stamp-${pv.property_type}-${pv.value}-${pv.conditions}`.replace(/[^a-z0-9-]/gi, '');
  return (
    <article class={`stamp stamp-${pv.source_type} ${pv.confirmed ? 'is-confirmed' : 'is-pending'}`}>
      <div class="stamp-art" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          <StampShape type={pv.source_type} />
        </svg>
        {sample && <span class="stamp-watermark">ILLUSTRATIVE</span>}
      </div>
      <div class="stamp-body">
        <p class="stamp-prop">{prettyProp(pv.property_type)}</p>
        <p class="stamp-value">{fmtValue(pv.value, pv.unit)}</p>
        <p class="stamp-type">{SOURCE_TYPE_LABEL[pv.source_type]}</p>
        {cond && <p class="stamp-cond">{cond}</p>}
      </div>
      <div class="stamp-seal">
        <Seal confirmed={pv.confirmed} />
      </div>
      <button class="stamp-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {open ? 'Hide provenance' : 'Provenance'}
      </button>
      {open && (
        <dl class="stamp-detail" id={id}>
          <dt>Source</dt>
          <dd>{sourceTitle ?? pv.source_id}</dd>
          <dt>Source type</dt>
          <dd>{SOURCE_TYPE_LABEL[pv.source_type]}</dd>
          <dt>Review status</dt>
          <dd>{pv.confirmed ? 'confirmed by a human (or a deterministic database load)' : 'awaiting human review'}</dd>
          {pv.extraction_method && (<><dt>Method</dt><dd>{pv.extraction_method}</dd></>)}
          {pv.note && (<><dt>Note</dt><dd>{pv.note}</dd></>)}
          {pv.quote && (<><dt>Supporting quote</dt><dd><q>{pv.quote}</q></dd></>)}
        </dl>
      )}
    </article>
  );
}

export function StampLegend() {
  const items: [PropertyValue['source_type'], string][] = [
    ['measured', 'circle'],
    ['dft', 'hexagon'],
    ['literature_asserted', 'rectangle'],
    ['mlip_predicted', 'diamond'],
  ];
  return (
    <ul class="stamp-legend" aria-label="Stamp legend">
      {items.map(([t, shape]) => (
        <li key={t} class={`stamp-${t}`}>
          <svg viewBox="0 0 100 100" width="18" height="18" aria-hidden="true"><StampShape type={t} /></svg>
          <span>{SOURCE_TYPE_LABEL[t]} <span class="muted">({shape})</span></span>
        </li>
      ))}
      <li><Seal confirmed size={18} /><span>reviewed</span></li>
      <li><Seal confirmed={false} size={18} /><span>awaiting review</span></li>
    </ul>
  );
}
