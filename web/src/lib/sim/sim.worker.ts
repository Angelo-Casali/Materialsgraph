/// <reference lib="webworker" />
// Runs whole-year simulations off the main thread so the controls stay responsive.
import type { Climate } from './climate';
import { type ControlPrices, type Scenario, simulate } from './engine';

interface Job {
  id: number;
  scenario: Scenario;
  climate: Climate;
  prices: ControlPrices;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, scenario, climate, prices } = e.data;
  try {
    const result = simulate(scenario, climate, prices);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
