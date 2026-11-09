import { useMemo, useState } from 'preact/hooks';
import { breakEvenElectricityPrice, DEFAULT_INPUTS, estimateScop, simulate, type HeatingInputs } from '../lib/challenges/heating-sim';

const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Num({ id, label, value, onInput, step = 'any', min = 0, max, unit, hint }: {
  id: string; label: string; value: number; onInput: (v: number) => void; step?: string; min?: number; max?: number; unit?: string; hint?: string;
}) {
  return (
    <div class="sim-field">
      <label for={id}>{label}{unit && <span class="muted"> ({unit})</span>}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        step={step}
        min={min}
        max={max}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onInput={(e) => onInput(parseFloat((e.target as HTMLInputElement).value))}
      />
      {hint && <span id={`${id}-hint`} class="sim-hint muted">{hint}</span>}
    </div>
  );
}

export function HeatingSimulator() {
  const [inp, setInp] = useState<HeatingInputs>(DEFAULT_INPUTS);
  const [flow, setFlow] = useState(45);
  const [outdoor, setOutdoor] = useState(7);
  const set = (k: keyof HeatingInputs) => (v: number) => setInp((s) => ({ ...s, [k]: v }));

  const results = useMemo(() => simulate(inp), [inp]);
  const breakEven = useMemo(() => breakEvenElectricityPrice(inp), [inp]);
  const est = estimateScop(flow, outdoor);
  const maxCost = Math.max(...results.map((r) => r.costEur), 1);
  const maxCo2 = Math.max(...results.map((r) => r.co2Kg), 1);
  const hpCheaper = inp.electricityPricePerKWh < breakEven;

  return (
    <div class="sim">
      <form class="sim-form" onSubmit={(e) => e.preventDefault()} aria-label="Simulator inputs">
        <fieldset>
          <legend>Your home</legend>
          <Num id="sim-demand" label="Useful heat needed per year" unit="kWh" value={inp.heatDemandKWh} onInput={set('heatDemandKWh')} step="100" hint="Gas used last year × boiler efficiency × 9.85 kWh/Smc is a good first guess." />
          <Num id="sim-boiler" label="Boiler seasonal efficiency" unit="%" value={Math.round(inp.boilerEfficiency * 100)} onInput={(v) => set('boilerEfficiency')(v / 100)} step="1" max={110} />
          <Num id="sim-scop" label="Heat pump seasonal COP (SCOP)" value={inp.scop} onInput={set('scop')} step="0.1" min={1} max={7} />
          <div class="sim-est">
            <p class="small"><strong>No SCOP at hand?</strong> Estimate it from temperatures (rough, Carnot-based):</p>
            <div class="sim-est-row">
              <div class="sim-field">
                <label for="sim-flow">Water temperature</label>
                <select id="sim-flow" value={flow} onChange={(e) => setFlow(parseFloat((e.target as HTMLSelectElement).value))}>
                  <option value="35">35 °C, underfloor heating</option>
                  <option value="45">45 °C, oversized radiators</option>
                  <option value="55">55 °C, radiators</option>
                  <option value="65">65 °C, old radiators</option>
                </select>
              </div>
              <Num id="sim-outdoor" label="Mean outdoor temp. in the heating season" unit="°C" value={outdoor} onInput={setOutdoor} step="0.5" min={-20} max={20} />
              <button type="button" class="btn-ghost btn small" onClick={() => set('scop')(Math.round(est * 10) / 10)}>Use {nf2.format(est)}</button>
            </div>
          </div>
          <div class="sim-field">
            <label for="sim-share">Heat pump share in the hybrid: {Math.round(inp.hybridHpShare * 100)}%</label>
            <input id="sim-share" type="range" min={0} max={100} step={5} value={Math.round(inp.hybridHpShare * 100)} onInput={(e) => set('hybridHpShare')(parseFloat((e.target as HTMLInputElement).value) / 100)} />
          </div>
        </fieldset>
        <fieldset>
          <legend>Prices <span class="muted small">(examples, use your bill)</span></legend>
          <Num id="sim-gas" label="Gas" unit="€/Smc" value={inp.gasPricePerSmc} onInput={set('gasPricePerSmc')} step="0.01" />
          <Num id="sim-elec" label="Electricity" unit="€/kWh" value={inp.electricityPricePerKWh} onInput={set('electricityPricePerKWh')} step="0.01" />
        </fieldset>
        <details class="sim-adv">
          <summary>Emission factors (ISPRA)</summary>
          <Num id="sim-ef-gas" label="Natural gas" unit="kg CO2/kWh" value={inp.gasKgCo2PerKWh} onInput={set('gasKgCo2PerKWh')} step="0.001" />
          <Num id="sim-ef-el" label="Electricity, Italy" unit="kg CO2/kWh" value={inp.electricityKgCo2PerKWh} onInput={set('electricityKgCo2PerKWh')} step="0.001" />
          <Num id="sim-lhv" label="Gas energy content" unit="kWh/Smc" value={inp.gasKWhPerSmc} onInput={set('gasKWhPerSmc')} step="0.01" />
        </details>
      </form>

      <div class="sim-out" aria-live="polite">
        <p class={`sim-verdict ${hpCheaper ? 'is-good' : 'is-bad'}`}>
          <span aria-hidden="true">{hpCheaper ? '✓' : '!'}</span>{' '}
          With these numbers the heat pump is {hpCheaper ? 'cheaper' : 'more expensive'} to run than the boiler. Break-even: electricity at{' '}
          <strong>{nf2.format(breakEven)} €/kWh</strong>.
        </p>
        <div class="table-scroll" tabIndex={0} role="region" aria-label="Results table (scrollable)">
          <table class="sim-table">
            <caption class="sr-only">Yearly energy, cost and CO2 per system</caption>
            <thead>
              <tr><th scope="col">System</th><th scope="col">Gas (Smc)</th><th scope="col">Electricity (kWh)</th><th scope="col">Cost (€/yr)</th><th scope="col">CO2 (kg/yr)</th></tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.label}</th>
                  <td>{nf0.format(r.gasSmc)}</td>
                  <td>{nf0.format(r.electricityKWh)}</td>
                  <td>{nf0.format(r.costEur)}</td>
                  <td>{nf0.format(r.co2Kg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="sim-bars" aria-hidden="true">
          {(['cost', 'co2'] as const).map((k) => (
            <div key={k} class="sim-bar-group">
              <p class="small muted">{k === 'cost' ? 'Running cost per year' : 'CO2 per year'}</p>
              {results.map((r) => {
                const v = k === 'cost' ? r.costEur : r.co2Kg;
                const w = (v / (k === 'cost' ? maxCost : maxCo2)) * 100;
                return (
                  <div key={r.id} class="sim-bar-row">
                    <span class="sim-bar-label">{r.label}</span>
                    <span class="sim-bar-track"><span class={`sim-bar sim-bar-${r.id}`} style={{ width: `${w}%` }} /></span>
                    <span class="sim-bar-val">{nf0.format(v)} {k === 'cost' ? '€' : 'kg'}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p class="small muted">
          A first-order model: one seasonal efficiency per machine, no standing charges, maintenance or purchase cost. Real SCOP depends on the machine,
          the sizing and the controls.
        </p>
      </div>
    </div>
  );
}
