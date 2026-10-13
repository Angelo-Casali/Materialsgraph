import { useMemo } from 'preact/hooks';
import { Constellation } from '../components/Constellation';
import { Formula, Pill, Seal, Title } from '../components/bits';
import { CompositionPanel, VerdictBanner } from '../components/Results';
import { Stamp, StampLegend } from '../components/Stamp';
import { analyse } from '../lib/engine/composition';
import { assess } from '../lib/engine/feasibility';
import { BASIS_LABEL } from '../lib/format';
import { fancy } from '../lib/lexicon';
import { href } from '../lib/router';
import type { Atlas } from '../lib/snapshot';
import { NotFound } from './NotFound';

export function Passport({ atlas, materialKey }: { atlas: Atlas; materialKey: string }) {
  const m = atlas.byKey.get(materialKey);
  const comp = useMemo(() => (m ? analyse(atlas, m) : null), [atlas, m]);
  if (!m || !comp) return <NotFound />;
  const sample = atlas.snap.meta.sample;
  const reviewed = m.properties.filter((p) => p.confirmed).length;

  return (
    <article class="page passport">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href={href.atlas()}>Atlas</a> <span aria-hidden="true">›</span>{' '}
        {m.composition.slice(0, 3).map((c, i) => <span key={c.symbol}>{i ? ' · ' : ''}<a href={href.atlas([c.symbol])}>{c.symbol}</a></span>)}{' '}
        <span aria-hidden="true">›</span> <span aria-current="page">{m.common_name ?? m.formula}</span>
      </nav>

      <header class="passport-cover">
        <div class="passport-emblem" aria-hidden="true">
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="57" class="emblem-ring" />
            <circle cx="60" cy="60" r="36" class="emblem-ring thin" />
            {m.composition.map((c, i, arr) => {
              const a = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
              return <text key={c.symbol} x={60 + Math.cos(a) * 46.5} y={60 + Math.sin(a) * 46.5 + 3.5} text-anchor="middle" class="emblem-el">{c.symbol}</text>;
            })}
            <text x="60" y="66" text-anchor="middle" class="emblem-core">{m.kind === 'molecule' ? '⌬' : '◈'}</text>
          </svg>
        </div>
        <div class="passport-id">
          {fancy('passport') && <p class="kicker">{fancy('passport')}</p>}
          <h1><Formula f={m.formula} /></h1>
          <p class="passport-sub">
            {m.common_name && <strong>{m.common_name}</strong>}
            <Pill tone={m.kind}>{m.kind}</Pill>
            {m.structure_type && <span>{m.structure_type}</span>}
            {m.spacegroup && <span>space group {m.spacegroup}</span>}
          </p>
          {m.blurb && <p class="lede">{m.blurb}</p>}
          <dl class="passport-facts">
            <div><dt>Graph key</dt><dd><code>{m.key}</code></dd></div>
            {m.inchikey && <div><dt>InChIKey</dt><dd><code>{m.inchikey}</code></dd></div>}
            {m.smiles && <div><dt>SMILES</dt><dd><code>{m.smiles}</code></dd></div>}
            {m.mp_id && <div><dt>Materials Project</dt><dd><a href={`https://next-gen.materialsproject.org/materials/${m.mp_id}`}>{m.mp_id}</a></dd></div>}
            <div><dt>Reviewed values</dt><dd>{reviewed} of {m.properties.length}</dd></div>
          </dl>
        </div>
      </header>

      <section aria-labelledby="stamps-h">
        <Title lex="stamps" level={2}><span id="stamps-h">Property values and where they come from</span></Title>
        <StampLegend />
        {m.properties.length ? (
          <div class="stamp-grid">
            {m.properties.map((pv, i) => <Stamp key={i} pv={pv} sample={sample} sourceTitle={atlas.sources.get(pv.source_id)?.title} />)}
          </div>
        ) : (
          <p class="muted">No property values recorded yet.</p>
        )}
      </section>

      <div class="two-col">
        <section aria-labelledby="comp-h">
          <h2 id="comp-h">Composition and supply risk</h2>
          <CompositionPanel result={comp} atlas={atlas} />
        </section>

        <section aria-labelledby="visa-h">
          <Title lex="visas" level={2}><span id="visa-h">Applications</span></Title>
          <p class="small muted">“Computed” means a database enumerated it, not that anyone built the cell. Pending tags were proposed by the harvester and await review.</p>
          <ul class="visas">
            {m.used_in.map((u) => {
              const f = assess(atlas, m.key, u.application);
              return (
                <li key={u.application} class={`visa ${u.confirmed ? '' : 'is-pending'}`}>
                  <div class="visa-head">
                    <Seal confirmed={u.confirmed} size={22} />
                    <a href={href.quest(u.application, m.key)}><strong>{u.application}</strong></a>
                  </div>
                  <p class="small muted">basis: {BASIS_LABEL[u.basis] ?? u.basis}{u.confirmed ? '' : ' · awaiting review'}</p>
                  {f && f.rows.length > 0 && <VerdictBanner verdict={f.verdict} />}
                </li>
              );
            })}
            {!m.used_in.length && <li class="muted">No application tags yet.</li>}
          </ul>
          <p><a class="btn btn-ghost" href={href.quest(m.used_in[0]?.application ?? 'solid electrolyte', m.key)}>Test against another application</a></p>
        </section>
      </div>

      <section aria-labelledby="const-h">
        <Title lex="constellation" level={2}><span id="const-h">How it connects</span></Title>
        <Constellation atlas={atlas} m={m} />
      </section>
    </article>
  );
}
