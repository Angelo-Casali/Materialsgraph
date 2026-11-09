import homeHeating from '../../data/challenges/home-heating.json';
import type { Challenge } from './types';

/** All published challenges, newest first. Add a JSON file in src/data/challenges and list it here. */
export const CHALLENGES: Challenge[] = [homeHeating as Challenge];

export function findChallenge(slug: string): Challenge | undefined {
  return CHALLENGES.find((c) => c.slug === slug);
}
