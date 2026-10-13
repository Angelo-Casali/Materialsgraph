import { signal } from '@preact/signals';
import type { Application, ElementFlags, Material, PropertyTypeInfo, Snapshot, Source } from './types';

export interface Atlas {
  snap: Snapshot;
  byKey: Map<string, Material>;
  byElement: Map<string, Material[]>;
  props: Map<string, PropertyTypeInfo>;
  apps: Map<string, Application>;
  flags: Map<string, ElementFlags>;
  sources: Map<string, Source>;
}

export function indexSnapshot(snap: Snapshot): Atlas {
  const byKey = new Map(snap.materials.map((m) => [m.key, m]));
  const byElement = new Map<string, Material[]>();
  for (const m of snap.materials) {
    for (const c of m.composition) {
      const list = byElement.get(c.symbol) ?? [];
      list.push(m);
      byElement.set(c.symbol, list);
    }
  }
  return {
    snap,
    byKey,
    byElement,
    props: new Map(snap.property_types.map((p) => [p.name, p])),
    apps: new Map(snap.applications.map((a) => [a.name, a])),
    flags: new Map(snap.elements.map((e) => [e.symbol, e])),
    sources: new Map(snap.sources.map((s) => [s.source_id, s])),
  };
}

export const atlas = signal<Atlas | null>(null);
export const loadError = signal<string | null>(null);

export async function loadSnapshot(url = `${import.meta.env.BASE_URL}data/snapshot.json`): Promise<Atlas> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap = (await res.json()) as Snapshot;
    const a = indexSnapshot(snap);
    atlas.value = a;
    return a;
  } catch (err) {
    loadError.value = `Could not load the atlas data (${(err as Error).message}).`;
    throw err;
  }
}

/** Materials containing ALL the given element symbols. */
export function materialsWithAll(a: Atlas, symbols: string[]): Material[] {
  if (!symbols.length) return [];
  const [first, ...rest] = symbols;
  return (a.byElement.get(first) ?? []).filter((m) => rest.every((s) => m.composition.some((c) => c.symbol === s)));
}

export function displayName(m: Material): string {
  return m.common_name ? `${m.common_name}` : m.formula;
}
