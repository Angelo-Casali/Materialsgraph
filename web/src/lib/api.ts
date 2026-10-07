import { signal } from '@preact/signals';

/** Public base URL of the free-tier API (Vercel). Empty = static-only mode. Never put secrets in VITE_* vars. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export type ApiState = 'unconfigured' | 'unknown' | 'waking' | 'awake' | 'sealed' | 'offline' | 'rate_limited';
export const apiState = signal<ApiState>(API_BASE ? 'unknown' : 'unconfigured');
export const apiInfo = signal<{ llm: boolean; db: string; sample?: boolean | null } | null>(null);
export const wakeElapsed = signal(0);

export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 25000): Promise<T> {
  if (!API_BASE) throw new ApiError(0, 'no live API configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        detail = ((await res.json()) as { detail?: string }).detail ?? detail;
      } catch {
        /* non-JSON error */
      }
      const retry = Number(res.headers.get('Retry-After') ?? '') || undefined;
      if (res.status === 429) apiState.value = 'rate_limited';
      if (res.status === 503) apiState.value = 'sealed';
      throw new ApiError(res.status, String(detail), retry);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, (err as Error).name === 'AbortError' ? 'request timed out' : 'network error');
  } finally {
    clearTimeout(timer);
  }
}

export interface ToolResponse {
  use_case: string; rows: any[]; notes: string[]; source_ids: string[]; extra: Record<string, any>;
  cypher: string[]; citations: { source_id: string; title?: string; year?: number; doi?: string }[]; elapsed_ms: number;
}
export interface AskResponse {
  answer: null | { question: string; use_case: string; text: string; citations: ToolResponse['citations']; confidence_notes: string[]; cypher_used: string[]; rows: any[] };
  route: any; degraded: boolean; message?: string | null; llm_provider?: string | null;
}

export const api = {
  health: (deep = false) => request<{ status: string; db: string; llm: string; sample?: boolean | null }>(`/api/health${deep ? '?deep=1' : ''}`, {}, 15000),
  tool: (useCase: string, params: unknown) => request<ToolResponse>(`/api/tools/${useCase}`, { method: 'POST', body: JSON.stringify(params) }),
  ask: (question: string, useCase?: string) => request<AskResponse>('/api/ask', { method: 'POST', body: JSON.stringify({ question, use_case: useCase || undefined }) }, 45000),
};

let waking: Promise<ApiState> | null = null;

/** Ping until the free-tier API (and its database) answers, with backoff up to ~60 s. */
export function wake(): Promise<ApiState> {
  if (!API_BASE) return Promise.resolve('unconfigured');
  if (apiState.value === 'awake') return Promise.resolve('awake');
  if (waking) return waking;
  const started = Date.now();
  apiState.value = 'waking';
  const tick = setInterval(() => (wakeElapsed.value = Math.round((Date.now() - started) / 1000)), 1000);
  waking = (async () => {
    const delays = [0, 2000, 4000, 8000, 8000, 8000, 10000, 10000, 10000];
    for (const d of delays) {
      if (d) await new Promise((r) => setTimeout(r, d));
      try {
        const h = await api.health(true);
        apiInfo.value = { llm: h.llm === 'configured', db: h.db, sample: h.sample };
        apiState.value = h.db === 'ok' ? 'awake' : h.db === 'sealed' ? 'sealed' : 'offline';
        if (h.db === 'ok' || h.db === 'sealed') break;
      } catch {
        apiState.value = 'waking';
      }
      if (Date.now() - started > 60000) break;
    }
    if (apiState.value === 'waking') apiState.value = 'offline';
    clearInterval(tick);
    waking = null;
    return apiState.value;
  })();
  return waking;
}

export const STATE_LABEL: Record<ApiState, string> = {
  unconfigured: 'Static atlas (no live server configured)',
  unknown: 'Live lab not contacted yet',
  waking: 'Waking the lab…',
  awake: 'Live lab awake',
  sealed: 'Graph database asleep — answering from the static atlas',
  offline: 'Live lab unreachable — answering from the static atlas',
  rate_limited: 'Too many requests — please wait a moment',
};
