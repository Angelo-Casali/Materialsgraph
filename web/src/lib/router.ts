import { signal } from '@preact/signals';

export type RouteName = 'atlas' | 'material' | 'quests' | 'quest' | 'ask' | 'how' | 'about' | 'notfound';
export interface Route { name: RouteName; params: Record<string, string>; query: URLSearchParams }

const TABLE: [RegExp, RouteName, string[]][] = [
  [/^\/?$/, 'atlas', []],
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
  for (const [re, name, keys] of TABLE) {
    const m = path.match(re);
    if (m) {
      const params: Record<string, string> = {};
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
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
  atlas: (elements: string[] = []) => (elements.length ? `#/?el=${elements.join(',')}` : '#/'),
  material: (key: string) => `#/m/${encodeURIComponent(key)}`,
  quests: () => '#/quests',
  quest: (app: string, material?: string) => `#/q/${encodeURIComponent(app)}${material ? `?m=${encodeURIComponent(material)}` : ''}`,
  ask: () => '#/ask',
  how: () => '#/how',
  about: () => '#/about',
};
