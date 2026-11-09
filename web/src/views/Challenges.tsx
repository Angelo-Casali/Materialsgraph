import { Title } from '../components/bits';
import { CHALLENGES } from '../lib/challenges';
import { RINGS } from '../lib/challenges/types';
import { href } from '../lib/router';

/** Challenges on the roadmap, not yet published (editorial). */
const NEXT = [
  'Ceramic kilns: cutting gas in the firing of tiles',
  'Thermal energy storage for homes and industry',
  'Domestic and community battery storage',
];

export function Challenges() {
  return (
    <div class="page">
      <Title lex="challenges">Energy-transition challenges</Title>
      <p class="lede">
        One page per problem: the numbers that define it, why it is hard, a radar of the technologies in play and, where it helps, a simulator you can
        play with. Every number links to its source; every judgement is marked as such.
      </p>

      <ul class="ch-grid" role="list">
        {CHALLENGES.map((c) => {
          const counts = RINGS.map((r) => ({ ...r, n: c.technologies.filter((t) => t.ring === r.id).length })).filter((r) => r.n);
          return (
            <li key={c.slug}>
              <a class="ch-card" href={href.challenge(c.slug)}>
                <span class="ch-domain">{c.domain === 'domestic' ? 'Homes' : 'Industry'}</span>
                <span class="ch-card-title">{c.title}</span>
                <span class="ch-card-sub">{c.subtitle}</span>
                <span class="ch-rings" aria-label="Technologies by radar ring">
                  {counts.map((r) => (
                    <span key={r.id} class={`ring-chip ring-${r.id}`}>{r.n} {r.label}</span>
                  ))}
                </span>
                <span class="ch-card-foot muted">
                  {c.figures.length} sourced figures · {c.sources.length} sources{c.simulator ? ' · simulator' : ''} · updated {c.updated}
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <section class="ch-next" aria-labelledby="next-title">
        <h2 id="next-title">Coming next</h2>
        <ul>
          {NEXT.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>

      <section class="ch-legacy" aria-labelledby="legacy-title">
        <h2 id="legacy-title">The battery-materials graph</h2>
        <p>
          The original MaterialsGraph, a provenance-first knowledge graph of battery materials with feasibility studies, is still here and still works
          from its snapshot.
        </p>
        <a class="btn-ghost btn" href={href.atlas()}>Open the materials atlas</a>
      </section>
    </div>
  );
}
