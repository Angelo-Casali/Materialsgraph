import { useState } from 'preact/hooks';
import { HeatingSimulator } from '../components/HeatingSimulator';
import { blipPositions, Radar } from '../components/Radar';
import { findChallenge } from '../lib/challenges';
import { RINGS, type Challenge, type Point } from '../lib/challenges/types';
import { href } from '../lib/router';
import { NotFound } from './NotFound';

/** Numbered source reference. Hash routing forbids in-page #anchors, so it scrolls with a button. */
function Refs({ ids, c }: { ids?: string[]; c: Challenge }) {
  if (!ids?.length) return null;
  return (
    <span class="refs">
      {ids.map((id) => {
        const i = c.sources.findIndex((s) => s.id === id);
        const s = c.sources[i];
        if (!s) return null;
        return (
          <button
            key={id}
            type="button"
            class="ref"
            aria-label={`Source ${i + 1}: ${s.title}`}
            title={s.title}
            onClick={() => {
              const el = document.getElementById(`src-${id}`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el?.focus({ preventScroll: true });
            }}
          >
            {i + 1}
          </button>
        );
      })}
    </span>
  );
}

function PointList({ points, c }: { points: Point[]; c: Challenge }) {
  return (
    <ul class="ch-points">
      {points.map((p) => (
        <li key={p.text}>
          {p.text} <Refs ids={p.sources} c={c} />
          {p.editorial && <span class="editorial" title="The author's judgement, not a cited fact">editorial</span>}
        </li>
      ))}
    </ul>
  );
}

export function ChallengeView({ slug }: { slug: string }) {
  const c = findChallenge(slug);
  const [sel, setSel] = useState<string | null>(null);
  if (!c) return <NotFound />;
  const pos = blipPositions(c.technologies);
  const ordered = [...c.technologies].sort((a, b) => pos.get(a.id)!.n - pos.get(b.id)!.n);

  const select = (id: string) => {
    setSel(id);
    document.getElementById(`tech-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <div class="page ch-page">
      <nav class="crumbs small" aria-label="Breadcrumb">
        <a href={href.challenges()}>Challenges</a> <span aria-hidden="true">›</span> <span>{c.domain === 'domestic' ? 'Homes' : 'Industry'}</span>
      </nav>
      <header class="title-block">
        <p class="kicker">Challenge · updated {c.updated}</p>
        <h1>{c.title}</h1>
      </header>
      <p class="lede">{c.subtitle}</p>

      <section aria-labelledby="fig-t">
        <h2 id="fig-t">The problem in numbers</h2>
        <ul class="fig-grid" role="list">
          {c.figures.map((f) => (
            <li key={f.label} class="fig">
              <span class="fig-value">{f.value}</span>
              <span class="fig-label">{f.label} <Refs ids={f.sources} c={c} /></span>
              {f.note && <span class="fig-note muted small">{f.note}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="hard-t">
        <h2 id="hard-t">Why it is hard</h2>
        <PointList points={c.whyHard} c={c} />
      </section>

      <section aria-labelledby="radar-t2">
        <h2 id="radar-t2">Technology radar</h2>
        <p class="muted small">
          {RINGS.map((r, i) => <span key={r.id}>{i ? ' · ' : ''}<strong>{r.label}</strong>: {r.meaning}</span>)}
        </p>
        <div class="radar-layout">
          <Radar techs={c.technologies} selected={sel} onSelect={select} />
          <ol class="tech-list">
            {ordered.map((t) => (
              <li key={t.id} id={`tech-${t.id}`} class={`tech ${sel === t.id ? 'is-on' : ''}`}>
                <button type="button" class="tech-head" aria-expanded={sel === t.id} onClick={() => setSel(sel === t.id ? null : t.id)}>
                  <span class={`tech-n blip-${t.ring}`} aria-hidden="true">{pos.get(t.id)!.n}</span>
                  <span class="tech-name">{t.name}</span>
                  <span class={`ring-chip ring-${t.ring}`}>{RINGS.find((r) => r.id === t.ring)!.label}</span>
                </button>
                {sel === t.id && (
                  <div class="tech-body">
                    <p>{t.summary}</p>
                    <p><strong>Why this ring:</strong> {t.why} <Refs ids={t.sources} c={c} /></p>
                    <p class="small"><strong>Limits</strong></p>
                    <ul class="small">{t.limits.map((l) => <li key={l}>{l}</li>)}</ul>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {c.simulator === 'home-heating' && (
        <section aria-labelledby="sim-t">
          <h2 id="sim-t">Simulator: boiler, heat pump or hybrid?</h2>
          <p class="muted">Change any number. Defaults: a 10,000 kWh home, ISPRA emission factors, example prices.</p>
          <HeatingSimulator />
        </section>
      )}

      <section aria-labelledby="ai-t">
        <h2 id="ai-t">Where AI can help</h2>
        <PointList points={c.aiAngle} c={c} />
      </section>

      <section aria-labelledby="oq-t">
        <h2 id="oq-t">Open questions</h2>
        <ul class="ch-points">{c.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
      </section>

      <section aria-labelledby="log-t">
        <h2 id="log-t">What changed</h2>
        <ul class="ch-points">{c.changelog.map((e) => <li key={e.date + e.text}><strong>{e.date}</strong>: {e.text}</li>)}</ul>
      </section>

      <section aria-labelledby="src-t">
        <h2 id="src-t">Sources</h2>
        <ol class="src-list">
          {c.sources.map((s) => (
            <li key={s.id} id={`src-${s.id}`} tabIndex={-1}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
              <span class="muted"> · {s.publisher} · {s.date}</span>
              {s.note && <span class="muted small"> · {s.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
