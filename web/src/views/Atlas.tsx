import { useMemo, useState } from 'preact/hooks';
import { Title } from '../components/bits';
import { MaterialCard } from '../components/MaterialCard';
import { OverlayLegend, PeriodicTable, type Overlay } from '../components/PeriodicTable';
import { MaterialSearch } from '../components/Search';
import { fancy } from '../lib/lexicon';
import { href } from '../lib/router';
import { materialsWithAll, type Atlas } from '../lib/snapshot';
import type { PeriodicElement } from '../data/periodic';

const OVERLAYS: { id: Overlay; label: string; hint: string }[] = [
  { id: 'materials', label: 'Materials', hint: 'how many materials contain each element' },
  { id: 'criticality', label: 'Criticality', hint: 'EU and US critical raw-material lists' },
  { id: 'fog', label: 'Data coverage', hint: 'where measurements are missing' },
  { id: 'none', label: 'Plain table', hint: 'no overlay' },
];
const FEATURED = ['sample:Li7La3Zr2O12', 'sample:LiNi0.8Mn0.1Co0.1O2', 'sample:LiFePO4', 'sample:Li6PS5Cl', 'sample:mol:ec', 'sample:Na3V2(PO4)3'];

export function AtlasView({ atlas, query }: { atlas: Atlas; query: URLSearchParams }) {
  const [overlay, setOverlay] = useState<Overlay>('materials');
  const fogProps = useMemo(() => {
    const used = new Set(atlas.snap.materials.flatMap((m) => m.properties.map((p) => p.property_type)));
    return atlas.snap.property_types.filter((p) => used.has(p.name)).map((p) => p.name);
  }, [atlas]);
  const [fogProperty, setFogProperty] = useState(fogProps.includes('ionic_conductivity') ? 'ionic_conductivity' : fogProps[0] ?? 'voltage');
  const [selected, setSelected] = useState<string[]>(() => (query.get('el') ?? '').split(',').filter(Boolean).slice(0, 3));
  const [inspect, setInspect] = useState<PeriodicElement | null>(null);

  const setSel = (next: string[]) => {
    setSelected(next);
    try {
      history.replaceState(null, '', href.atlas(next));
    } catch {
      /* sandboxed frames */
    }
  };
  const toggle = (sym: string) => {
    if (selected.includes(sym)) setSel(selected.filter((s) => s !== sym));
    else setSel([...selected.slice(-2), sym]);
  };
  const matches = useMemo(() => materialsWithAll(atlas, selected), [atlas, selected]);
  const counts = atlas.snap.meta.counts;
  const confirmedShare = useMemo(() => {
    const all = atlas.snap.materials.flatMap((m) => m.properties);
    return all.length ? Math.round((100 * all.filter((p) => p.confirmed).length) / all.length) : 0;
  }, [atlas]);
  const featured = FEATURED.map((k) => atlas.byKey.get(k)).filter(Boolean);
  const insp = inspect ? { mats: atlas.byElement.get(inspect.symbol)?.length ?? 0, flags: atlas.flags.get(inspect.symbol) } : null;

  return (
    <div class="page atlas-page">
      <section class="hero">
        <div class="hero-text">
          {fancy('atlas') && <p class="kicker">{fancy('atlas')}</p>}
          <h1>Explore battery materials, element by element</h1>
          <p class="lede">
            A knowledge graph that remembers <em>where every number came from</em>: measured or computed, reviewed by a human or still awaiting review.
            Pick elements to chart the materials they form, then open a material's passport or run a feasibility study.
          </p>
          <div class="hero-stats" aria-label="Snapshot statistics">
            <span class="stat"><strong>{counts.materials}</strong> materials</span>
            <span class="stat"><strong>{counts.property_values}</strong> values with provenance</span>
            <span class="stat"><strong>{confirmedShare}%</strong> of values reviewed</span>
            <span class="stat"><strong>{atlas.snap.applications.length}</strong> applications</span>
          </div>
          <div class="hero-cta">
            <a class="btn" href={href.quests()}>Run a feasibility study</a>
            <a class="btn btn-ghost" href={href.how()}>How the data is gathered</a>
          </div>
        </div>
        <div class="hero-search">
          <MaterialSearch atlas={atlas} onPick={(m) => (location.hash = href.material(m.key))} />
        </div>
      </section>

      <section class="atlas-board" aria-labelledby="table-heading">
        <div class="board-controls">
          <h2 id="table-heading" class="sr-only">Periodic table</h2>
          <div class="segmented" role="radiogroup" aria-label="Map overlay">
            {OVERLAYS.map((o) => (
              <button key={o.id} role="radio" aria-checked={overlay === o.id} class={overlay === o.id ? 'is-on' : ''} title={o.hint} onClick={() => setOverlay(o.id)}>
                {o.id === 'fog' && fancy('fog') ? fancy('fog') : o.label}
              </button>
            ))}
          </div>
          {overlay === 'fog' && (
            <label class="inline-field">
              <span>Property</span>
              <select value={fogProperty} onChange={(e) => setFogProperty((e.target as HTMLSelectElement).value)}>
                {fogProps.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
          )}
        </div>
        <OverlayLegend overlay={overlay} fogProperty={fogProperty} />
        <div class="ptable-scroll">
          <PeriodicTable atlas={atlas} overlay={overlay} fogProperty={fogProperty} selected={selected} onToggle={toggle} onInspect={setInspect} />
        </div>
        <p class="inspector" aria-hidden="true">
          {inspect && insp ? (
            <>
              <strong>{inspect.name}</strong> ({inspect.symbol}, Z = {inspect.z}) · {insp.mats} material{insp.mats === 1 ? '' : 's'}
              {insp.flags?.eu_crm_2023 && ' · EU critical'}{insp.flags?.usgs_2022 && ' · US critical'}
              {insp.flags?.note && <span class="muted"> · {insp.flags.note}</span>}
            </>
          ) : (
            <span class="muted">Hover or focus an element to inspect it. Select up to three to find materials containing all of them.</span>
          )}
        </p>
      </section>

      <section class="selection" aria-labelledby="sel-heading" aria-live="polite">
        {selected.length ? (
          <>
            <div class="selection-head">
              <h2 id="sel-heading">
                {matches.length} material{matches.length === 1 ? '' : 's'} containing {selected.join(' + ')}
              </h2>
              <button class="btn btn-ghost" onClick={() => setSel([])}>Clear selection</button>
            </div>
            {matches.length ? (
              <div class="card-grid">{matches.map((m) => <MaterialCard key={m.key} m={m} />)}</div>
            ) : (
              <p class="muted">No charted material contains all of {selected.join(', ')}. Uncharted territory, so far.</p>
            )}
          </>
        ) : (
          <>
            <Title lex="atlas" level={2}>Start here</Title>
            <p class="muted">Six well-known materials, or select elements in the table above.</p>
            <div class="card-grid">{featured.map((m) => <MaterialCard key={m!.key} m={m!} />)}</div>
          </>
        )}
      </section>
    </div>
  );
}
