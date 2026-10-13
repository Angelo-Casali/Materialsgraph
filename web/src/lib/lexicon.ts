import { plainMode } from './prefs';

/** Every fantasy term is paired with its plain meaning; Plain mode shows only the plain one. */
export const LEX = {
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

export function fancy(key: LexKey): string | null {
  return plainMode.value ? null : LEX[key].fancy;
}
export function plain(key: LexKey): string {
  return LEX[key].plain;
}
