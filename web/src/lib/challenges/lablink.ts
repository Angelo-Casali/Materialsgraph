import { href } from '../router';
import type { Story } from './types';

/**
 * Link that opens the heating lab with a story's scenarios. Same format as the lab's own share links
 * (see lib/sim/scenario.ts), built here without importing the simulation code into the challenge page;
 * the lab fills every missing field with its defaults and validates everything it reads.
 */
export function labLink(lab: NonNullable<Story['lab']>): string {
  const json = JSON.stringify({ v: 1, p: lab.place, s: lab.scenarios.slice(0, 4), m: {} });
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${href.lab('home-heating')}?s=${b64}`;
}
