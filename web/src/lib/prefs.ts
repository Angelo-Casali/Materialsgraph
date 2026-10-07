import { effect, signal } from '@preact/signals';

// localStorage can throw (private mode, blocked storage); every access is guarded.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export type Theme = 'light' | 'dark' | 'system';
const initialTheme = read('mg.theme');
export const theme = signal<Theme>(initialTheme === 'light' || initialTheme === 'dark' ? initialTheme : 'system');
export const plainMode = signal<boolean>(read('mg.plain') === '1');

export function startPrefs(): void {
  effect(() => {
    const t = theme.value;
    const root = document.documentElement;
    if (t === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    write('mg.theme', t === 'system' ? null : t);
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121829' : '#fbf6ea');
  });
  effect(() => {
    if (plainMode.value) document.documentElement.setAttribute('data-plain', '1');
    else document.documentElement.removeAttribute('data-plain');
    write('mg.plain', plainMode.value ? '1' : null);
  });
}

export function cycleTheme(): void {
  theme.value = theme.value === 'system' ? 'dark' : theme.value === 'dark' ? 'light' : 'system';
}
