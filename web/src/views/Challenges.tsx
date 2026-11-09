import { Sheet } from '../components/bits';
import { countStep } from '../components/PeriodicTable';
import { PERIODIC } from '../data/periodic';
import { CHALLENGES } from '../lib/challenges';
import { RINGS } from '../lib/challenges/types';
import { href } from '../lib/router';
import { atlas } from '../lib/snapshot';

/** Challenges on the roadmap, not yet published (editorial). */
const NEXT: { domain: string; title: string }[] = [
  { domain: 'Industry', title: 'Ceramic kilns: cutting gas in the firing of tiles' },
  { domain: 'Storage', title: 'Thermal energy storage for homes and industry' },
  { domain: 'Storage', title: 'Domestic and community battery storage' },
];

const RING_ORDER = RINGS.map((r) => r.id);

export function Challenges() {
  const figures = CHALLENGES.reduce((n, c) => n + c.figures.length, 0);
  const sources = CHALLENGES.reduce((n, c) => n + c.sources.length, 0);
  const techs = CHALLENGES.reduce((n, c) => n + c.technologies.length, 0);
  const a = atlas.value;

  return (
    <div class="page">
      <header class="home-hero">
        <div>
          <p class="kicker">MaterialsGraph · challenge tracker</p>
          <h1>Energy-transition problems, measured and sourced.</h1>
          <p class="lede">
            One page per problem: the numbers that define it, why it is hard, where each technology stands and, when it helps, a simulator. Every figure
            links to its source. Every judgement is labelled as one.
          </p>
        </div>
        <dl class="facts" aria-label="Tracker in numbers">
          <div><dt>Sourced figures</dt><dd>{figures}</dd></div>
          <div><dt>Sources</dt><dd>{sources}</dd></div>
          <div><dt>Technologies</dt><dd>{techs}</dd></div>
        </dl>
      </header>

      <Sheet n="01" title="Challenges" id="index">
        <ol class="idx" role="list">
          {CHALLENGES.map((c, i) => {
            const sorted = [...c.technologies].sort((x, y) => RING_ORDER.indexOf(x.ring) - RING_ORDER.indexOf(y.ring));
            const counts = RINGS.map((r) => `${c.technologies.filter((t) => t.ring === r.id).length} ${r.label}`).join(', ');
            return (
              <li key={c.slug} class="idx-row">
                <a class="idx-link" href={href.challenge(c.slug)}>
                  <span class="idx-n">{String(i + 1).padStart(2, '0')}</span>
                  <span class="idx-domain">{c.domain === 'domestic' ? 'Homes' : 'Industry'}</span>
                  <span>
                    <span class="idx-title">{c.title}</span>
                    <span class="idx-sub">{c.subtitle}</span>
                  </span>
                  <span class="idx-mini" role="img" aria-label={`Technologies by maturity: ${counts}`}>
                    {sorted.map((t) => <span key={t.id} class={`r-${t.ring}`} title={`${t.name} · ${t.ring}`} />)}
                  </span>
                  <span class="idx-meta">
                    {c.sources.length} sources<br />
                    {c.simulator ? 'simulator' : '—'}<br />
                    {c.updated}
                  </span>
                </a>
              </li>
            );
          })}
          {NEXT.map((n, i) => (
            <li key={n.title} class="idx-row is-planned">
              <div class="idx-link">
                <span class="idx-n">{String(CHALLENGES.length + i + 1).padStart(2, '0')}</span>
                <span class="idx-domain">{n.domain}</span>
                <span class="idx-title">{n.title}</span>
                <span />
                <span class="idx-meta">in preparation</span>
              </div>
            </li>
          ))}
        </ol>
        <p class="idx-legend" aria-hidden="true">
          <span><i style={{ background: 'var(--ink)' }} /> Adopt</span>
          <span><i style={{ background: 'var(--heat-350)' }} /> Trial</span>
          <span><i /> Assess</span>
          <span><i style={{ background: 'var(--hatch)', color: 'var(--ink-3)' }} /> Hold</span>
          <span>one cell per technology on each challenge's radar</span>
        </p>
      </Sheet>

      <Sheet n="02" title="Battery-materials atlas" id="atlas">
        <div class="atlas-teaser">
          <div>
            <p>
              The original MaterialsGraph: a knowledge graph of battery materials where every value records its source, whether it was measured or computed,
              and whether a human has reviewed it. Explore it element by element, open a material's datasheet, or test a material against an application's
              targets.
            </p>
            <p class="muted small">Frozen: maintained and tested, not extended. Runs from a static snapshot.</p>
            <p><a class="btn" href={href.atlas()}>Open the atlas</a></p>
          </div>
          <div class="mini-table" role="img" aria-label={a ? `Periodic table: ${a.byElement.size} elements appear in the ${a.snap.meta.counts.materials} materials of the atlas` : 'Periodic table thumbnail'}>
            {PERIODIC.filter((e) => e.row <= 7).map((e) => {
              const n = a?.byElement.get(e.symbol)?.length ?? 0;
              const step = countStep(n);
              return (
                <span
                  key={e.symbol}
                  class={n ? 'on' : ''}
                  style={{ gridRow: e.row, gridColumn: e.col, background: n ? `var(--heat-${step})` : undefined }}
                />
              );
            })}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
