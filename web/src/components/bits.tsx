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

/** Heading with the plain term as the accessible name and the fantasy term as a kicker. */
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

export function Seal({ confirmed, size = 28 }: { confirmed: boolean; size?: number }) {
  if (!confirmed) {
    return (
      <span class="seal seal-pending" title="Awaiting human review (confirmed = false)">
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" />
          <text x="16" y="20.5" text-anchor="middle" font-size="12" fill="currentColor">?</text>
        </svg>
        <span class="sr-only">awaiting review</span>
      </span>
    );
  }
  return (
    <span class="seal seal-ok" title="Reviewed (confirmed = true)">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 2l3 3.2 4.3-.8 1.2 4.2 4.1 1.6-1 4.2 2.6 3.6-3.5 2.6.3 4.4-4.4.6-2 3.9-4-1.9-4 1.9-2-3.9-4.4-.6.3-4.4L2.8 18l2.6-3.6-1-4.2 4.1-1.6 1.2-4.2 4.3.8z" class="seal-wax" />
        <path d="M10.5 16.5l3.5 3.5 7.5-8" fill="none" class="seal-mark" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="sr-only">reviewed</span>
    </span>
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

export function Icon({ name }: { name: 'sun' | 'moon' | 'auto' | 'compass' | 'scroll' | 'flask' | 'quest' | 'info' | 'code' }) {
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
  };
  return (
    <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={p[name]} />
    </svg>
  );
}
