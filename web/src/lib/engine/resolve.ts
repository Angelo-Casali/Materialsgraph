import type { Atlas } from '../snapshot';
import type { Material } from '../types';

/** Resolve free text (formula, acronym, common name, key) to a material via the snapshot's alias table. */
export function resolveMaterial(a: Atlas, text: string): Material | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const key = a.snap.aliases[t] ?? (a.byKey.has(text.trim()) ? text.trim() : undefined);
  return key ? a.byKey.get(key) ?? null : null;
}

/** Ranked fuzzy search for the combobox: prefix matches first, then substring. */
export function searchMaterials(a: Atlas, text: string, limit = 8): Material[] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const scored: { m: Material; s: number }[] = [];
  for (const m of a.snap.materials) {
    const names = [m.formula, m.common_name ?? '', m.reduced_formula].map((x) => x.toLowerCase());
    let s = 0;
    if (names.some((n) => n === t)) s = 3;
    else if (names.some((n) => n.startsWith(t))) s = 2;
    else if (names.some((n) => n.includes(t))) s = 1;
    if (s) scored.push({ m, s });
  }
  return scored.sort((x, y) => y.s - x.s || x.m.formula.length - y.m.formula.length).slice(0, limit).map((x) => x.m);
}
