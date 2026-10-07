import { useEffect, useRef, useState } from 'preact/hooks';
import { API_BASE, apiState, STATE_LABEL, wake } from '../lib/api';
import { cycleTheme, plainMode, theme } from '../lib/prefs';
import { href, route, type RouteName } from '../lib/router';
import { atlas } from '../lib/snapshot';
import { Icon } from './bits';

const NAV: { name: RouteName[]; label: string; fancy: string; link: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { name: ['atlas', 'material'], label: 'Explore', fancy: 'Atlas', link: href.atlas(), icon: 'compass' },
  { name: ['quests', 'quest'], label: 'Feasibility', fancy: 'Quests', link: href.quests(), icon: 'quest' },
  { name: ['ask'], label: 'Ask', fancy: 'Oracle', link: href.ask(), icon: 'flask' },
  { name: ['how'], label: 'How it works', fancy: 'The harvest', link: href.how(), icon: 'scroll' },
  { name: ['about'], label: 'About', fancy: 'Colophon', link: href.about(), icon: 'info' },
];

export function Logo() {
  return (
    <a class="logo" href={href.atlas()} aria-label="MaterialsGraph, home">
      <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden="true" class="logo-mark">
        <circle cx="32" cy="32" r="26" class="logo-ring" />
        <circle cx="32" cy="32" r="18" class="logo-ring thin" />
        <path d="M32 4 L36.5 32 L32 60 L27.5 32 Z" class="logo-needle" />
        <path d="M4 32 L32 27.5 L60 32 L32 36.5 Z" class="logo-needle alt" />
        <circle cx="32" cy="32" r="4" class="logo-hub" />
      </svg>
      <span class="logo-text">
        <span class="logo-name">MaterialsGraph</span>
        <span class="logo-sub">the periodic atlas</span>
      </span>
    </a>
  );
}

export function SampleBadge() {
  const a = atlas.value;
  const ref = useRef<HTMLDialogElement>(null);
  if (!a?.snap.meta.sample) return null;
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
          <span aria-hidden="true">☰</span><span class="sr-only">Menu</span>
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
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {!plainMode.value && <span class="nav-fancy" aria-hidden="true">{n.fancy}</span>}
            </a>
          ))}
        </nav>
        <div class="header-tools">
          <SampleBadge />
          <button class="icon-btn" onClick={() => (plainMode.value = !plainMode.value)} aria-pressed={plainMode.value} title="Plain mode removes the fantasy vocabulary">
            <span aria-hidden="true">{plainMode.value ? 'Aa' : '✒'}</span>
            <span class="sr-only">Plain language mode</span>
          </button>
          <button class="icon-btn" onClick={cycleTheme} title={`Theme: ${t}`}>
            <Icon name={t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'auto'} />
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
        <p>
          <strong>MaterialsGraph</strong> — a provenance-first knowledge graph of battery materials, built in the open.{' '}
          <a href="https://github.com/Angelo-Casali/Materialsgraph">Source on GitHub</a> · <a href={href.about()}>About &amp; licences</a>
        </p>
        {a && (
          <p class="muted small">
            Snapshot {a.snap.meta.generated_at.slice(0, 10)}{a.snap.meta.git_sha ? ` · ${a.snap.meta.git_sha}` : ''} · {a.snap.meta.counts.materials} materials ·{' '}
            {a.snap.meta.counts.property_values} values{a.snap.meta.sample ? ' · illustrative sample' : ''} · runs on free tiers only
          </p>
        )}
      </div>
    </footer>
  );
}
