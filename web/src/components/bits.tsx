import type { ComponentChildren } from 'preact';
import { fancy, plain, type LexKey } from '../lib/lexicon';
import { formulaRuns } from '../lib/format';
import type { ReqStatus } from '../lib/engine/feasibility';

export function Formula({ f, class: cls }: { f: string; class?: string }) {
  return (
    <span class={`formula ${cls ?? ''}`} aria-label={f}>
      {formulaRuns(f).map((r, i) => (r.sub ? <sub key={i}>{r.text}</sub> : <span key={i}>{r.text}</span>))}
    </span>
  );
}

/** Page or section heading; the label comes from the plain-language lexicon. */
export function Title({ lex, level = 1, children }: { lex: LexKey; level?: 1 | 2; children?: ComponentChildren }) {
  const kicker = fancy(lex);
  const H = level === 1 ? 'h1' : 'h2';
  return (
    <header class="title-block">
      {kicker && <p class="kicker" aria-hidden="true">{kicker}</p>}
      <H>{children ?? plain(lex)}</H>
    </header>
  );
}

const STATUS: Record<ReqStatus, { icon: string; label: string }> = {
  met: { icon: '✓', label: 'Met' },
  unmet: { icon: '✕', label: 'Not met' },
  missing: { icon: '?', label: 'No data' },
  conflicting: { icon: '!', label: 'Sources disagree' },
};

export function StatusPill({ status, compact = false }: { status: ReqStatus; compact?: boolean }) {
  const s = STATUS[status];
  return (
    <span class={`status status-${status}`} title={s.label}>
      <span class="status-icon" aria-hidden="true">{s.icon}</span>
      {compact ? <span class="sr-only">{s.label}</span> : <span>{s.label}</span>}
    </span>
  );
}

/** Review state as a square marker: filled = reviewed (confirmed), dashed = awaiting human review. */
export function Seal({ confirmed, labelled = false }: { confirmed: boolean; size?: number; labelled?: boolean }) {
  const text = confirmed ? 'reviewed' : 'pending review';
  return (
    <span class={`seal ${confirmed ? 'seal-ok' : 'seal-pending'}`} title={confirmed ? 'Reviewed by a human (confirmed = true)' : 'Awaiting human review (confirmed = false)'}>
      <span class="seal-box" aria-hidden="true" />
      {labelled ? <span class="seal-text">{text}</span> : <span class="sr-only">{text}</span>}
    </span>
  );
}

/** One ruled section: a numbered label column and a body column. */
export function Sheet({ n, title, id, children }: { n?: string; title: string; id?: string; children: ComponentChildren }) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section class="sheet" id={id} aria-labelledby={hid}>
      <h2 class="sheet-label" id={hid}>
        {n && <span class="sheet-n">{n}</span>}
        <span>{title}</span>
      </h2>
      <div class="sheet-body">{children}</div>
    </section>
  );
}

export function Pill({ children, tone = 'neutral', title }: { children: ComponentChildren; tone?: string; title?: string }) {
  return <span class={`pill pill-${tone}`} title={title}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true" class="empty-art">
        <path d="M8 46c8-4 14 4 22 0s12-10 26-6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 4" />
        <circle cx="46" cy="18" r="8" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M43 18h6M46 15v6" stroke="currentColor" stroke-width="2" />
      </svg>
      <p class="empty-title">{title}</p>
      {children && <div class="empty-body">{children}</div>}
    </div>
  );
}

export function Icon({ name }: { name: 'sun' | 'moon' | 'auto' | 'compass' | 'scroll' | 'flask' | 'quest' | 'info' | 'code' | 'radar' }) {
  const p: Record<string, string> = {
    sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 100 10 5 5 0 000-10z',
    moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
    auto: 'M12 3a9 9 0 100 18V3z',
    compass: 'M12 2a10 10 0 100 20 10 10 0 000-20zM15.5 8.5l-2 5-5 2 2-5z',
    scroll: 'M6 4h11a3 3 0 010 6H8M6 4a2 2 0 00-2 2v12a2 2 0 002 2h11a2 2 0 002-2V10M6 4a2 2 0 012 2v12',
    flask: 'M9 3h6M10 3v6L4.5 18.5A2 2 0 006.2 21.5h11.6a2 2 0 001.7-3L14 9V3',
    quest: 'M4 21V4l8 3 8-3v13l-8 3-8-3',
    info: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 11v6M12 7.5v.01',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
    radar: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 7a5 5 0 100 10 5 5 0 000-10zM12 12l6.5-6.5',
  };
  return (
    <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={p[name]} />
    </svg>
  );
}
