import { describe, expect, it } from 'vitest';
import { CHALLENGES } from './index';
import { RINGS } from './types';

const RING_IDS = new Set(RINGS.map((r) => r.id));

describe.each(CHALLENGES.map((c) => [c.slug, c] as const))('challenge %s', (_slug, c) => {
  const ids = new Set(c.sources.map((s) => s.id));

  it('has unique, URL-safe slug and ids', () => {
    expect(c.slug).toMatch(/^[a-z0-9-]+$/);
    expect(ids.size).toBe(c.sources.length);
    expect(new Set(c.technologies.map((t) => t.id)).size).toBe(c.technologies.length);
  });

  it('every figure cites at least one existing source', () => {
    for (const f of c.figures) {
      expect(f.sources.length, f.label).toBeGreaterThan(0);
      for (const s of f.sources) expect(ids.has(s), `${f.label} -> ${s}`).toBe(true);
    }
  });

  it('every technology has a valid ring and cites existing sources', () => {
    for (const t of c.technologies) {
      expect(RING_IDS.has(t.ring), t.id).toBe(true);
      expect(t.sources.length, t.id).toBeGreaterThan(0);
      for (const s of t.sources) expect(ids.has(s), `${t.id} -> ${s}`).toBe(true);
    }
  });

  it('every statement is either sourced or marked editorial', () => {
    for (const p of [...c.whyHard, ...c.aiAngle]) {
      const sourced = (p.sources ?? []).length > 0;
      expect(sourced || p.editorial === true, p.text).toBe(true);
      for (const s of p.sources ?? []) expect(ids.has(s), `${p.text} -> ${s}`).toBe(true);
    }
  });

  it('every source has an https URL and a date', () => {
    for (const s of c.sources) {
      expect(s.url, s.id).toMatch(/^https:\/\//);
      expect(s.date, s.id).toMatch(/^\d{4}(-\d{2}(-\d{2})?)?$/);
    }
  });

  it('every source is used somewhere', () => {
    const used = new Set([...c.figures.flatMap((f) => f.sources), ...c.technologies.flatMap((t) => t.sources), ...[...c.whyHard, ...c.aiAngle].flatMap((p) => p.sources ?? [])]);
    for (const s of c.sources) expect(used.has(s.id), s.id).toBe(true);
  });
});
