import { useEffect, useRef, useState } from 'preact/hooks';
import { API_BASE, apiState, STATE_LABEL, wake } from '../lib/api';
import { cycleTheme, theme } from '../lib/prefs';
import { href, route, type RouteName } from '../lib/router';
import { atlas } from '../lib/snapshot';
import { Icon } from './bits';

const NAV: { name: RouteName[]; label: string; fancy: string; link: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { name: ['challenges', 'challenge'], label: 'Challenges', fancy: 'Tracker', link: href.challenges(), icon: 'radar' },
  { name: ['atlas', 'material'], label: 'Materials', fancy: 'Atlas', link: href.atlas(), icon: 'compass' },
  { name: ['quests', 'quest'], label: 'Feasibility', fancy: 'Quests', link: href.quests(), icon: 'quest' },
  { name: ['ask'], label: 'Ask', fancy: 'Oracle', link: href.ask(), icon: 'flask' },
  { name: ['how'], label: 'Method', fancy: 'The harvest', link: href.how(), icon: 'scroll' },
  { name: ['about'], label: 'About', fancy: 'Colophon', link: href.about(), icon: 'info' },
];

/** MaterialsGraph abbreviates to Mg: magnesium, element 12. The mark is its periodic-table cell. */
export function Logo() {
  return (
    <a class="logo" href={href.challenges()} aria-label="MaterialsGraph, home">
      <span class="logo-cell" aria-hidden="true">
        <span class="z">12</span>
        <span class="sym">Mg</span>
        <span class="w">24.305</span>
      </span>
      <span class="logo-text">
        <span class="logo-name">MaterialsGraph</span>
        <span class="logo-sub">energy transition · materials</span>
      </span>
    </a>
  );
}

export function SampleBadge() {
  const a = atlas.value;
  const ref = useRef<HTMLDialogElement>(null);
  const r = route.value.name;
  // the badge describes the materials-atlas snapshot; challenge pages cite real sources
  if (!a?.snap.meta.sample || r === 'challenges' || r === 'challenge') return null;
  return (
    <>
      <button class="sample-badge" onClick={() => ref.current?.showModal()} aria-haspopup="dialog">
        <span aria-hidden="true">✶</span> Sample data
      </button>
      <dialog ref={ref} class="dialog" aria-labelledby="sample-title" onClick={(e) => e.target === ref.current && ref.current?.close()}>
        <h2 id="sample-title">This atlas shows an illustrative sample</h2>
        <p>{a.snap.meta.notice}</p>
        <ul>
          <li>Every value cites one non-citable source, <code>sample:illustrative</code>. There are no invented DOIs or database ids.</li>
          <li>Values are rounded, commonly reported numbers, labelled by the kind of number they are (measured or DFT-computed) and the conditions they refer to.</li>
          <li>Similarity links are machine suggestions and stay “awaiting review”, exactly as the real pipeline would write them.</li>
          <li>The owner regenerates this site from the real graph with <code>mg export site</code>.</li>
        </ul>
        <form method="dialog"><button class="btn">Got it</button></form>
      </dialog>
    </>
  );
}

export function ApiLamp({ autoWake = false }: { autoWake?: boolean }) {
  const s = apiState.value;
  useEffect(() => {
    if (autoWake && API_BASE) void wake();
  }, [autoWake]);
  return (
    <span class={`lamp lamp-${s}`} role="status" aria-live="polite" title={STATE_LABEL[s]}>
      <span class="lamp-dot" aria-hidden="true" />
      <span class="lamp-text">{STATE_LABEL[s]}</span>
    </span>
  );
}

export function Header() {
  const r = route.value.name;
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [r]);
  const t = theme.value;
  return (
    <header class="site-header">
      <div class="header-inner">
        <Logo />
        <button class="menu-toggle btn-ghost" aria-expanded={menu} aria-controls="site-nav" onClick={() => setMenu(!menu)}>
          <span aria-hidden="true">Menu</span><span class="sr-only">Open the menu</span>
        </button>
        <nav id="site-nav" class={`site-nav ${menu ? 'is-open' : ''}`} aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.link}
              href={n.link}
              class="nav-link"
              aria-current={n.name.includes(r) ? 'page' : undefined}
              onMouseEnter={n.name.includes('ask') && API_BASE ? () => void wake() : undefined}
            >
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div class="header-tools">
          <SampleBadge />
          <button class="icon-btn" onClick={cycleTheme} title="Colour theme: auto follows your system">
            <span aria-hidden="true">{t === 'system' ? 'Auto' : t === 'dark' ? 'Dark' : 'Light'}</span>
            <span class="sr-only">Theme: {t}. Activate to change.</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const a = atlas.value;
  return (
    <footer class="site-footer">
      <div class="footer-inner">
        <p class="label">MaterialsGraph · built in the open · free tiers only</p>
        <p>
          Sourced state of the art on energy-transition problems, and a provenance-first knowledge graph of battery materials.{' '}
          <a href="https://github.com/Angelo-Casali/Materialsgraph">Source on GitHub</a> · <a href={href.about()}>About and licences</a>
        </p>
        {a && (
          <p class="muted small mono">
            atlas snapshot {a.snap.meta.generated_at.slice(0, 10)}{a.snap.meta.git_sha ? ` · ${a.snap.meta.git_sha}` : ''} · {a.snap.meta.counts.materials} materials ·{' '}
            {a.snap.meta.counts.property_values} values{a.snap.meta.sample ? ' · illustrative sample' : ''}
          </p>
        )}
      </div>
    </footer>
  );
}
