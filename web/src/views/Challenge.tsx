import { useState } from 'preact/hooks';
import { Sheet } from '../components/bits';
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
          <span>
            {p.text} <Refs ids={p.sources} c={c} />
            {p.editorial && <span class="editorial" title="The author's judgement, not a cited fact">editorial</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SECTIONS = [
  ['fig', 'Numbers'], ['hard', 'Why hard'], ['radar', 'Radar'], ['sim', 'Simulator'], ['ai', 'AI'], ['oq', 'Open questions'], ['src', 'Sources'],
] as const;

export function ChallengeView({ slug }: { slug: string }) {
  const c = findChallenge(slug);
  const [sel, setSel] = useState<string | null>(null);
  if (!c) return <NotFound />;
  const pos = blipPositions(c.technologies);
  const ordered = [...c.technologies].sort((a, b) => pos.get(a.id)!.n - pos.get(b.id)!.n);
  const n = (id: string) => String(SECTIONS.filter(([k]) => k !== 'sim' || c.simulator).findIndex(([k]) => k === id) + 1).padStart(2, '0');

  const select = (id: string) => {
    setSel(id);
    document.getElementById(`tech-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const jump = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div class="page ch-page">
      <header class="ch-head">
        <nav class="crumbs" aria-label="Breadcrumb">
          <a href={href.challenges()}>Challenges</a> / {c.domain === 'domestic' ? 'Homes' : 'Industry'}
        </nav>
        <p class="kicker">Challenge · updated {c.updated} · {c.sources.length} sources</p>
        <h1>{c.title}</h1>
        <p class="lede">{c.subtitle}</p>
        <nav class="toc" aria-label="On this page">
          {SECTIONS.filter(([k]) => k !== 'sim' || c.simulator).map(([k, label]) => (
            <button key={k} type="button" onClick={() => jump(k)}>{label}</button>
          ))}
        </nav>
      </header>

      <Sheet n={n('fig')} title="The problem in numbers" id="fig">
        <ul class="fig-grid" role="list">
          {c.figures.map((f) => (
            <li key={f.label} class="fig">
              <span class="fig-value">{f.value}</span>
              <span class="fig-label">{f.label} <Refs ids={f.sources} c={c} /></span>
              {f.note && <span class="fig-note muted">{f.note}</span>}
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet n={n('hard')} title="Why it is hard" id="hard">
        <PointList points={c.whyHard} c={c} />
      </Sheet>

      <Sheet n={n('radar')} title="Technology radar" id="radar">
        <dl class="ring-key">
          {RINGS.map((r) => (
            <div key={r.id}>
              <dt><span class={`ring-sw ${r.id}`} aria-hidden="true" />{r.label}</dt>
              <dd>{r.meaning}</dd>
            </div>
          ))}
        </dl>
        <div class="radar-layout">
          <Radar techs={c.technologies} selected={sel} onSelect={select} />
          <ol class="tech-list">
            {ordered.map((t) => (
              <li key={t.id} id={`tech-${t.id}`} class={`tech ${sel === t.id ? 'is-on' : ''}`}>
                <button type="button" class="tech-head" aria-expanded={sel === t.id} onClick={() => setSel(sel === t.id ? null : t.id)}>
                  <span class="tech-n" aria-hidden="true">{String(pos.get(t.id)!.n).padStart(2, '0')}</span>
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
      </Sheet>

      {c.simulator === 'home-heating' && (
        <Sheet n={n('sim')} title="Simulator: boiler, heat pump or hybrid?" id="sim">
          <p class="muted" style={{ marginTop: 0 }}>Change any number. Defaults: a 10,000 kWh home, ISPRA emission factors, example prices.</p>
          <HeatingSimulator />
        </Sheet>
      )}

      <Sheet n={n('ai')} title="Where AI can help" id="ai">
        <PointList points={c.aiAngle} c={c} />
      </Sheet>

      <Sheet n={n('oq')} title="Open questions" id="oq">
        <ul class="ch-points">{c.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
        <h3>What changed</h3>
        <ul class="ch-points">{c.changelog.map((e) => <li key={e.date + e.text}><span><span class="mono small">{e.date}</span> · {e.text}</span></li>)}</ul>
      </Sheet>

      <Sheet n={n('src')} title="Sources" id="src">
        <ol class="src-list">
          {c.sources.map((s) => (
            <li key={s.id} id={`src-${s.id}`} tabIndex={-1}>
              <span>
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                <span class="src-meta">{s.publisher} · {s.date}{s.note ? ` · ${s.note}` : ''}</span>
              </span>
            </li>
          ))}
        </ol>
      </Sheet>
    </div>
  );
}
