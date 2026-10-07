import { href } from '../lib/router';
import type { Material } from '../lib/types';
import { Formula, Pill } from './bits';

export function MaterialCard({ m }: { m: Material }) {
  const pending = m.properties.filter((p) => !p.confirmed).length + m.used_in.filter((u) => !u.confirmed).length;
  return (
    <a class="mcard" href={href.material(m.key)}>
      <span class="mcard-head">
        <Formula f={m.formula} class="mcard-formula" />
        {m.common_name && m.common_name !== m.formula && <span class="mcard-name">{m.common_name}</span>}
      </span>
      <span class="mcard-meta">
        <Pill tone={m.kind === 'molecule' ? 'molecule' : 'crystal'}>{m.kind}</Pill>
        {m.structure_type && <span class="muted">{m.structure_type}</span>}
      </span>
      <span class="mcard-apps">
        {m.used_in.map((u) => (
          <span key={u.application} class={`chip ${u.confirmed ? '' : 'chip-pending'}`}>{u.application}{u.confirmed ? '' : ' (pending)'}</span>
        ))}
      </span>
      <span class="mcard-foot muted">
        {m.properties.length} value{m.properties.length === 1 ? '' : 's'}
        {pending > 0 && ` · ${pending} awaiting review`}
      </span>
    </a>
  );
}
