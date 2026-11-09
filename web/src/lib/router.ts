import { signal } from '@preact/signals';

export type RouteName = 'challenges' | 'challenge' | 'atlas' | 'material' | 'quests' | 'quest' | 'ask' | 'how' | 'about' | 'notfound';
export interface Route { name: RouteName; params: Record<string, string>; query: URLSearchParams }

const TABLE: [RegExp, RouteName, string[]][] = [
  [/^\/?$/, 'challenges', []],
  [/^\/c\/(.+)$/, 'challenge', ['slug']],
  [/^\/atlas\/?$/, 'atlas', []],
  [/^\/m\/(.+)$/, 'material', ['key']],
  [/^\/quests\/?$/, 'quests', []],
  [/^\/q\/(.+)$/, 'quest', ['app']],
  [/^\/ask\/?$/, 'ask', []],
  [/^\/how\/?$/, 'how', []],
  [/^\/about\/?$/, 'about', []],
];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = new URLSearchParams(qs);
  // links shared before the atlas moved to #/atlas (e.g. "#/?el=Li,O") still open the atlas
  if ((path === '/' || path === '') && query.has('el')) return { name: 'atlas', params: {}, query };
  for (const [re, name, keys] of TABLE) {
    const m = path.match(re);
    if (m) {
      const params: Record<string, string> = {};
      try {
        keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      } catch {
        // malformed percent-escape in a shared or hand-typed link (e.g. "#/q/100%"): show the 404 view
        return { name: 'notfound', params: {}, query };
      }
      return { name, params, query };
    }
  }
  return { name: 'notfound', params: {}, query };
}

export const route = signal<Route>(parseHash(typeof location !== 'undefined' ? location.hash : ''));

export function startRouter(): void {
  const update = () => {
    route.value = parseHash(location.hash);
    window.scrollTo({ top: 0 });
    // move focus to the main region for screen-reader users after navigation
    const main = document.getElementById('main');
    main?.focus({ preventScroll: true });
  };
  window.addEventListener('hashchange', update);
}

export const href = {
  challenges: () => '#/',
  challenge: (slug: string) => `#/c/${encodeURIComponent(slug)}`,
  atlas: (elements: string[] = []) => (elements.length ? `#/atlas?el=${elements.join(',')}` : '#/atlas'),
  material: (key: string) => `#/m/${encodeURIComponent(key)}`,
  quests: () => '#/quests',
  quest: (app: string, material?: string) => `#/q/${encodeURIComponent(app)}${material ? `?m=${encodeURIComponent(material)}` : ''}`,
  ask: () => '#/ask',
  how: () => '#/how',
  about: () => '#/about',
};
