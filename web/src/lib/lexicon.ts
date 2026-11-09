/** Plain-language labels used across the site. (The earlier fantasy vocabulary was retired with the 2026-11 redesign;
 * `fancy()` stays as a no-op so call sites keep compiling.) */
export const LEX = {
  challenges: { plain: 'Energy-transition challenges', fancy: 'The challenge tracker' },
  radar: { plain: 'Technology radar', fancy: 'Radar' },
  atlas: { plain: 'Element explorer', fancy: 'The Periodic Atlas' },
  passport: { plain: 'Material profile', fancy: 'Material passport' },
  stamps: { plain: 'Property values with provenance', fancy: 'Provenance stamps' },
  visas: { plain: 'Applications', fancy: 'Visas' },
  quests: { plain: 'Feasibility studies', fancy: 'Quests' },
  quest: { plain: 'Feasibility study', fancy: 'Quest' },
  ask: { plain: 'Ask the graph', fancy: 'Ask the atlas' },
  how: { plain: 'How the data is collected', fancy: "The harvester's journey" },
  fog: { plain: 'Data coverage', fancy: 'Fog of war' },
  spell: { plain: 'Query used', fancy: 'Show the spell' },
  constellation: { plain: 'Related nodes', fancy: 'Constellation' },
  seal: { plain: 'Reviewed', fancy: 'Sealed' },
} as const;

export type LexKey = keyof typeof LEX;

export function fancy(_key: LexKey): string | null {
  return null;
}
export function plain(key: LexKey): string {
  return LEX[key].plain;
}
