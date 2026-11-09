/**
 * Challenge tracker data model.
 *
 * A challenge is one industrial or domestic problem in the energy transition, told with
 * numbers that each cite a source, the technical limits that make it hard, a radar of the
 * technologies in play and, where it helps, a small simulator.
 *
 * Rules (mirrored in challenges.test.ts):
 * - every figure and every technology cites at least one source id that exists in `sources`
 * - statements without a source are marked `editorial: true` (the author's judgement)
 */

/** Radar rings, ThoughtWorks style. */
export type Ring = 'adopt' | 'trial' | 'assess' | 'hold';

export const RINGS: { id: Ring; label: string; meaning: string }[] = [
  { id: 'adopt', label: 'Adopt', meaning: 'Mature, available today, the default choice where it fits.' },
  { id: 'trial', label: 'Trial', meaning: 'Works in practice; worth piloting, results depend on the context.' },
  { id: 'assess', label: 'Assess', meaning: 'Laboratory or prototype stage; watch it, do not plan on it yet.' },
  { id: 'hold', label: 'Hold', meaning: 'Avoid for new projects: regulation, cost or evidence point elsewhere.' },
];

export interface Source {
  id: string;
  title: string;
  publisher: string;
  /** ISO date of publication, or year when only the year is known */
  date: string;
  url: string;
  note?: string;
}

export interface Figure {
  value: string;
  label: string;
  note?: string;
  sources: string[];
}

export interface Point {
  text: string;
  sources?: string[];
  /** true when the statement is the author's judgement rather than a cited fact */
  editorial?: boolean;
}

export interface Technology {
  id: string;
  name: string;
  ring: Ring;
  /** short label for the radar blip */
  short: string;
  summary: string;
  why: string;
  limits: string[];
  sources: string[];
}

export interface ChangelogEntry {
  date: string;
  text: string;
}

export interface Challenge {
  slug: string;
  title: string;
  subtitle: string;
  domain: 'domestic' | 'industrial';
  updated: string;
  figures: Figure[];
  whyHard: Point[];
  technologies: Technology[];
  aiAngle: Point[];
  openQuestions: string[];
  simulator?: 'home-heating';
  changelog: ChangelogEntry[];
  sources: Source[];
}
