import { fmtConditions, fmtValue, prettyProp, SOURCE_TYPE_LABEL } from '../lib/format';
import type { PropertyValue } from '../lib/types';
import { Seal } from './bits';

const SHORT: Record<PropertyValue['source_type'], string> = {
  measured: 'Measured',
  dft: 'DFT',
  mlip_predicted: 'ML potential',
  literature_asserted: 'Literature',
};

/** Source-type tag: colour square + text, so the type never depends on colour alone. */
export function PvTag({ type }: { type: PropertyValue['source_type'] }) {
  return <span class={`pv-tag pv-${type}`} title={SOURCE_TYPE_LABEL[type]}>{SHORT[type]}</span>;
}

/** Datasheet of a material's property values, one row per value, with provenance columns. */
export function PvTable({ values, sourceTitle }: { values: PropertyValue[]; sourceTitle: (id: string) => string | undefined }) {
  return (
    <div class="table-wrap" tabIndex={0} role="region" aria-label="Property values (scrollable)">
      <table class="pv-table">
        <caption class="sr-only">Property values with their source, source type, conditions and review status</caption>
        <thead>
          <tr><th scope="col">Property</th><th scope="col">Value</th><th scope="col">Type</th><th scope="col">Conditions · note</th><th scope="col">Review</th><th scope="col">Source</th></tr>
        </thead>
        <tbody>
          {values.map((pv, i) => {
            const extra = [fmtConditions(pv.conditions), pv.note].filter(Boolean).join(' · ');
            return (
              <tr key={i}>
                <th scope="row">{prettyProp(pv.property_type)}</th>
                <td class="pv-value">{fmtValue(pv.value, pv.unit)}</td>
                <td><PvTag type={pv.source_type} /></td>
                <td class="small">{extra || <span class="muted">—</span>}{pv.quote && <><br /><q class="muted">{pv.quote}</q></>}</td>
                <td><Seal confirmed={pv.confirmed} labelled /></td>
                <td class="small muted">{sourceTitle(pv.source_id) ?? pv.source_id}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PvLegend() {
  const types: PropertyValue['source_type'][] = ['measured', 'dft', 'literature_asserted', 'mlip_predicted'];
  return (
    <ul class="pv-legend" aria-label="Legend">
      {types.map((t) => <li key={t}><PvTag type={t} /></li>)}
      <li><Seal confirmed labelled /></li>
      <li><Seal confirmed={false} labelled /></li>
    </ul>
  );
}
