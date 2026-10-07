import { useMemo, useState } from 'preact/hooks';
import { searchMaterials } from '../lib/engine/resolve';
import type { Atlas } from '../lib/snapshot';
import type { Material } from '../lib/types';
import { Formula } from './bits';

/** Accessible combobox (ARIA 1.2 list autocomplete) over materials. */
export function MaterialSearch({ atlas, onPick, label = 'Find a material', placeholder = 'LFP, LiCoO2, garnet, EC…', id = 'msearch' }: { atlas: Atlas; onPick: (m: Material) => void; label?: string; placeholder?: string; id?: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchMaterials(atlas, q), [atlas, q]);
  const pick = (m: Material) => { onPick(m); setQ(''); setOpen(false); };
  return (
    <div class="combo">
      <label for={id} class="combo-label">{label}</label>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
        autocomplete="off"
        placeholder={placeholder}
        value={q}
        onInput={(e) => { setQ((e.target as HTMLInputElement).value); setOpen(true); setActive(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((active + 1) % Math.max(results.length, 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + results.length) % Math.max(results.length, 1)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <ul class="combo-list" role="listbox" id={`${id}-list`}>
          {results.map((m, i) => (
            <li
              key={m.key}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              class={i === active ? 'is-active' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
            >
              <Formula f={m.formula} />
              {m.common_name && <span class="muted"> {m.common_name}</span>}
              <span class="combo-kind">{m.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
