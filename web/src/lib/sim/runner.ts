/**
 * Runs simulations in a Web Worker when the browser has one, on the main thread otherwise,
 * and remembers results so unchanged scenarios are not simulated twice.
 */
import type { Climate } from './climate';
import { type ControlPrices, type Scenario, type SimResult, simulate } from './engine';

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: SimResult) => void; reject: (e: Error) => void }>();
const cache = new Map<string, Promise<SimResult>>();

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; result?: SimResult; error?: string }>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.result) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error ?? 'simulation failed'));
      };
      worker.onerror = () => {
        workerFailed = true;
        for (const p of pending.values()) p.reject(new Error('worker failed'));
        pending.clear();
      };
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

export function runScenario(s: Scenario, c: Climate, prices: ControlPrices): Promise<SimResult> {
  const key = `${c.id}|${prices.electricity}|${prices.gasPerKWh}|${JSON.stringify(s)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = getWorker();
  const p: Promise<SimResult> = w
    ? new Promise<SimResult>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        w.postMessage({ id, scenario: s, climate: c, prices });
      }).catch(() => simulate(s, c, prices))
    : new Promise<SimResult>((resolve) => setTimeout(() => resolve(simulate(s, c, prices)), 0));
  cache.set(key, p);
  if (cache.size > 24) cache.delete(cache.keys().next().value as string);
  return p;
}
