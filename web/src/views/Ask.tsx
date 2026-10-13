import { useEffect, useMemo, useState } from 'preact/hooks';
import { ApiLamp } from '../components/Chrome';
import { Title } from '../components/bits';
import { CompositionPanel, FeasibilityGauge, FeasibilityTable, GapsPanel, ScreeningTable, SpellPanel, VerdictBanner, type FeasRow, type ScreenLike } from '../components/Results';
import { api, API_BASE, ApiError, apiInfo, apiState, wake, wakeElapsed, type AskResponse } from '../lib/api';
import { analyse, type CompositionResult } from '../lib/engine/composition';
import { applicationCoverage, domainCoverage, type CoverageRow } from '../lib/engine/coverage';
import { assess } from '../lib/engine/feasibility';
import { screen, type Constraint } from '../lib/engine/screening';
import { prettyProp } from '../lib/format';
import { href } from '../lib/router';
import { displayName, type Atlas } from '../lib/snapshot';

type UseCase = 'feasibility' | 'screening' | 'composition' | 'gaps';
type Result =
  | { kind: 'feasibility'; rows: FeasRow[]; verdict: string; materialKey?: string }
  | { kind: 'screening'; rows: ScreenLike[] }
  | { kind: 'composition'; result: CompositionResult }
  | { kind: 'gaps'; coverage: CoverageRow[]; gaps: { description: string; source_id: string; confirmed: boolean }[] };
interface Answered { result: Result; via: 'live' | 'static'; ms?: number; cypher: string[]; notes: string[] }

const TABS: { id: UseCase; label: string; blurb: string }[] = [
  { id: 'feasibility', label: 'Feasibility', blurb: 'Is material X fit for application Y?' },
  { id: 'screening', label: 'Screening', blurb: 'Which materials satisfy my constraints?' },
  { id: 'composition', label: 'Composition', blurb: 'What is it made of, and how critical is that?' },
  { id: 'gaps', label: 'Gaps', blurb: 'Where is the data missing?' },
];

const EXAMPLES = [
  'Is LLZO feasible as a solid electrolyte?',
  'Which cobalt-free Li-ion cathodes deliver more than 150 mAh/g?',
  'What is the critical-element exposure of NMC811?',
  'What data is missing for solid electrolytes?',
];

function normCoverage(rows: any[]): CoverageRow[] {
  return rows.map((r) => {
    const total = r.total_materials ?? r.total_materials_in_domain ?? r.total ?? 0;
    const withData = r.materials_with_data ?? r.with_data ?? 0;
    return { property_type: r.property_type, total, with_data: withData, missing: total - withData, coverage_pct: r.coverage_pct ?? 0 };
  });
}

export function Ask({ atlas }: { atlas: Atlas }) {
  const [tab, setTab] = useState<UseCase>('feasibility');
  const materials = useMemo(() => [...atlas.snap.materials].sort((a, b) => displayName(a).localeCompare(displayName(b))), [atlas]);
  const appNames = atlas.snap.applications.map((a) => a.name);
  const propNames = atlas.snap.property_types.map((p) => p.name);

  const [matKey, setMatKey] = useState('sample:Li7La3Zr2O12');
  const [app, setApp] = useState('solid electrolyte');
  const [sApp, setSApp] = useState('Li-ion cathode');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('Co');
  const [cons, setCons] = useState<Constraint[]>([{ property_type: 'specific_capacity', min: 150, max: null }]);
  const [stable, setStable] = useState(false);
  const [gApp, setGApp] = useState('solid electrolyte');
  const [answer, setAnswer] = useState<Answered | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [ask, setAsk] = useState<AskResponse | null>(null);
  const [askErr, setAskErr] = useState<string | null>(null);

  useEffect(() => {
    if (API_BASE) void wake();
  }, []);
  useEffect(() => {
    if (!atlas.byKey.has(matKey) && materials[0]) setMatKey(materials[0].key);
  }, [atlas]);

  const symbols = (s: string) => s.split(/[\s,+]+/).map((x) => x.trim()).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase());

  function staticAnswer(uc: UseCase): Answered {
    if (uc === 'feasibility') {
      const f = assess(atlas, matKey, app)!;
      return { result: { kind: 'feasibility', rows: f.rows, verdict: f.verdict, materialKey: matKey }, via: 'static', cypher: [], notes: [] };
    }
    if (uc === 'screening') {
      const rows = screen(atlas, { application: sApp || null, include_elements: symbols(include), exclude_elements: symbols(exclude), constraints: cons, max_energy_above_hull: stable ? 0.05 : null, kind: 'any' });
      return { result: { kind: 'screening', rows }, via: 'static', cypher: [], notes: [] };
    }
    if (uc === 'composition') {
      return { result: { kind: 'composition', result: analyse(atlas, atlas.byKey.get(matKey)!) }, via: 'static', cypher: [], notes: [] };
    }
    const coverage = gApp ? applicationCoverage(atlas, gApp) : domainCoverage(atlas);
    return { result: { kind: 'gaps', coverage, gaps: atlas.snap.gaps.filter((g) => !gApp || g.application === gApp) }, via: 'static', cypher: [], notes: [] };
  }

  async function run() {
    setBusy(true);
    const m = atlas.byKey.get(matKey);
    const material = m?.common_name ?? m?.formula ?? matKey;
    try {
      if (apiState.value === 'awake') {
        const params = {
          feasibility: { material, application: app, material_key: matKey },
          screening: { application: sApp || null, include_elements: symbols(include), exclude_elements: symbols(exclude), constraints: cons, max_energy_above_hull: stable ? 0.05 : null, kind: 'any', limit: 15 },
          composition: { material, material_key: matKey },
          gaps: { application: gApp || null },
        }[tab];
        try {
          const r = await api.tool(tab, params);
          let result: Result;
          if (tab === 'feasibility') result = { kind: 'feasibility', rows: r.rows as FeasRow[], verdict: String(r.extra.verdict ?? ''), materialKey: r.extra.material?.material_key };
          else if (tab === 'screening') result = { kind: 'screening', rows: r.rows as ScreenLike[] };
          else if (tab === 'composition') result = { kind: 'composition', result: { substitutions: [], ...(r.rows[0] ?? { elements: [], critical_elements: [], critical_atom_fraction: 0 }) } };
          else result = { kind: 'gaps', coverage: normCoverage(r.rows), gaps: (r.extra.gaps ?? []) as any[] };
          setAnswer({ result, via: 'live', ms: r.elapsed_ms, cypher: r.cypher, notes: r.notes });
          return;
        } catch (err) {
          const a = staticAnswer(tab);
          a.notes.push(`Live API failed (${(err as ApiError).message}); answered from the static atlas instead.`);
          setAnswer(a);
          return;
        }
      }
      setAnswer(staticAnswer(tab));
    } finally {
      setBusy(false);
    }
  }

  async function submitQuestion(e?: Event) {
    e?.preventDefault();
    setAskErr(null);
    setAsk(null);
    if (!question.trim()) return;
    if (apiState.value !== 'awake') {
      const st = await wake();
      if (st !== 'awake') {
        setAskErr('Free-text questions need the live lab (language model + graph database). It is not reachable right now, so use the guided builder above: it answers the same question types without an LLM.');
        return;
      }
    }
    setBusy(true);
    try {
      setAsk(await api.ask(question.trim()));
    } catch (err) {
      const e2 = err as ApiError;
      setAskErr(e2.status === 429 ? `Slow down a little: ${e2.message}${e2.retryAfter ? ` (retry in ${e2.retryAfter}s)` : ''}.` : `The live lab could not answer: ${e2.message}.`);
    } finally {
      setBusy(false);
    }
  }

  const llmAvailable = apiState.value === 'awake' && apiInfo.value?.llm;

  return (
    <div class="page ask-page">
      <Title lex="ask">Ask the graph</Title>
      <p class="lede">
        Two ways in. The <strong>guided builder</strong> runs the graph's deterministic tools and always works, live or from the static atlas.
        <strong> Free text</strong> goes through a language model that routes your question to the same tools and must cite every number.
      </p>
      <div class="lamp-row">
        <ApiLamp />
        {apiState.value === 'waking' && <span class="muted small">{wakeElapsed.value}s — free-tier servers nap when idle; the first call can take a while.</span>}
        {(apiState.value === 'offline' || apiState.value === 'sealed') && <button class="btn btn-ghost small" onClick={() => void wake()}>Try again</button>}
      </div>

      <section class="builder" aria-labelledby="builder-h">
        <h2 id="builder-h">Guided question</h2>
        <div class="tabs" role="tablist" aria-label="Question type">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="builder-panel" class={tab === t.id ? 'is-on' : ''} onClick={() => { setTab(t.id); setAnswer(null); }}>
              <span>{t.label}</span>
              <span class="tab-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
        <form id="builder-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} class="builder-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          {(tab === 'feasibility' || tab === 'composition') && (
            <p class="sentence">
              {tab === 'feasibility' ? 'Is ' : 'Analyse the composition of '}
              <select aria-label="Material" value={matKey} onChange={(e) => setMatKey((e.target as HTMLSelectElement).value)}>
                {materials.map((m) => <option key={m.key} value={m.key}>{displayName(m)}{m.common_name ? ` (${m.formula})` : ''}</option>)}
              </select>
              {tab === 'feasibility' && (
                <>
                  {' '}feasible as{' '}
                  <select aria-label="Application" value={app} onChange={(e) => setApp((e.target as HTMLSelectElement).value)}>
                    {appNames.map((a) => <option key={a}>{a}</option>)}
                  </select>
                  ?
                </>
              )}
            </p>
          )}
          {tab === 'screening' && (
            <div class="screen-form">
              <p class="sentence">
                Find{' '}
                <select aria-label="Application filter" value={sApp} onChange={(e) => setSApp((e.target as HTMLSelectElement).value)}>
                  <option value="">any material</option>
                  {appNames.map((a) => <option key={a} value={a}>{a} materials</option>)}
                </select>{' '}
                containing <input aria-label="Elements to include" class="short" value={include} placeholder="e.g. Li" onInput={(e) => setInclude((e.target as HTMLInputElement).value)} />{' '}
                but not <input aria-label="Elements to exclude" class="short" value={exclude} placeholder="e.g. Co" onInput={(e) => setExclude((e.target as HTMLInputElement).value)} />
              </p>
              {cons.map((c, i) => (
                <p class="sentence" key={i}>
                  with{' '}
                  <select aria-label={`Property ${i + 1}`} value={c.property_type} onChange={(e) => setCons(cons.map((x, j) => (j === i ? { ...x, property_type: (e.target as HTMLSelectElement).value } : x)))}>
                    {propNames.map((p) => <option key={p} value={p}>{prettyProp(p)}</option>)}
                  </select>{' '}
                  ≥ <input aria-label={`Minimum ${i + 1}`} type="number" step="any" class="short" value={c.min ?? ''} onInput={(e) => setCons(cons.map((x, j) => (j === i ? { ...x, min: (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value) } : x)))} />{' '}
                  and ≤ <input aria-label={`Maximum ${i + 1}`} type="number" step="any" class="short" value={c.max ?? ''} onInput={(e) => setCons(cons.map((x, j) => (j === i ? { ...x, max: (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value) } : x)))} />{' '}
                  {atlas.props.get(c.property_type)?.unit}
                  <button type="button" class="btn btn-ghost small" onClick={() => setCons(cons.filter((_, j) => j !== i))} aria-label={`Remove constraint ${i + 1}`}>remove</button>
                </p>
              ))}
              <p class="form-row">
                {cons.length < 3 && <button type="button" class="btn btn-ghost small" onClick={() => setCons([...cons, { property_type: 'voltage', min: null, max: null }])}>+ property constraint</button>}
                <label class="switch"><input type="checkbox" checked={stable} onChange={(e) => setStable((e.target as HTMLInputElement).checked)} /><span>only thermodynamically stable (E above hull ≤ 0.05 eV/atom)</span></label>
              </p>
            </div>
          )}
          {tab === 'gaps' && (
            <p class="sentence">
              What is missing for{' '}
              <select aria-label="Application" value={gApp} onChange={(e) => setGApp((e.target as HTMLSelectElement).value)}>
                <option value="">the whole Battery domain</option>
                {appNames.map((a) => <option key={a}>{a}</option>)}
              </select>
              ?
            </p>
          )}
          <button class="btn" type="submit" disabled={busy}>{busy ? 'Consulting…' : 'Answer'}</button>
        </form>

        {answer && (
          <div class="answer" aria-live="polite">
            <p class={`via via-${answer.via}`}>
              {answer.via === 'live' ? `Answered live by the graph API in ${answer.ms} ms` : `Answered in your browser from the static atlas (snapshot ${atlas.snap.meta.generated_at.slice(0, 10)})`}
            </p>
            {answer.notes.map((n, i) => <p key={i} class="note">{n}</p>)}
            <ResultView result={answer.result} atlas={atlas} />
            <SpellPanel cypher={answer.cypher} />
          </div>
        )}
      </section>

      <section class="freeform" aria-labelledby="ff-h">
        <h2 id="ff-h">Free-text question</h2>
        <form onSubmit={submitQuestion} class="ff-form">
          <label for="q" class="sr-only">Your question</label>
          <textarea id="q" maxLength={300} rows={2} placeholder="Ask about battery materials in plain language…" value={question} onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)} />
          <div class="ff-row">
            <span class="muted small">{question.length}/300 · routed by a free open model · numbers must cite a source</span>
            <button class="btn" type="submit" disabled={busy || !question.trim()}>Ask</button>
          </div>
        </form>
        <div class="examples" aria-label="Example questions">
          {EXAMPLES.map((q) => <button key={q} class="chip chip-btn" onClick={() => setQuestion(q)}>{q}</button>)}
        </div>
        {!API_BASE && <p class="note">This deployment has no live server configured, so free-text questions are switched off. The guided builder answers the same question types.</p>}
        {API_BASE && apiState.value === 'awake' && !llmAvailable && <p class="note">The live lab is awake but has no language model configured; use the guided builder.</p>}
        {askErr && <p class="note" role="alert">{askErr}</p>}
        {ask && <AskAnswer resp={ask} />}
      </section>
    </div>
  );
}

function ResultView({ result, atlas }: { result: Result; atlas: Atlas }) {
  if (result.kind === 'feasibility') {
    return (
      <div>
        <div class="assessment-head">
          {result.materialKey && atlas.byKey.get(result.materialKey) && <p>Material: <a href={href.material(result.materialKey)}>{displayName(atlas.byKey.get(result.materialKey)!)}</a></p>}
          <FeasibilityGauge rows={result.rows} />
        </div>
        <VerdictBanner verdict={result.verdict} />
        <FeasibilityTable rows={result.rows} atlas={atlas} />
      </div>
    );
  }
  if (result.kind === 'screening') return <ScreeningTable rows={result.rows} atlas={atlas} />;
  if (result.kind === 'composition') return <CompositionPanel result={result.result} atlas={atlas} />;
  return <GapsPanel coverage={result.coverage} gaps={result.gaps} sample={atlas.snap.meta.sample} />;
}

function AskAnswer({ resp }: { resp: AskResponse }) {
  if (resp.degraded || !resp.answer) return <p class="note">{resp.message ?? 'No answer.'}</p>;
  const a = resp.answer;
  const ids = new Set(a.citations.map((c) => c.source_id));
  const parts = a.text.split(/(\[[^\]]+\])/g);
  return (
    <div class="answer oracle">
      <p class="via via-live">Routed to <strong>{a.use_case}</strong>{resp.llm_provider ? ` · model ${resp.llm_provider.split('#')[1] ?? ''}` : ''}</p>
      <div class="oracle-text">
        {parts.map((p, i) => {
          const m = p.match(/^\[([^\]]+)\]$/);
          if (m && m[1].split(',').every((s) => ids.has(s.trim()))) return <span key={i} class="cite">{m[1]}</span>;
          return <span key={i}>{p}</span>;
        })}
      </div>
      {a.citations.length > 0 && (
        <ul class="citations">
          {a.citations.map((c) => <li key={c.source_id}><span class="cite">{c.source_id}</span> {c.title}{c.year ? ` (${c.year})` : ''}</li>)}
        </ul>
      )}
      {a.confidence_notes.map((n, i) => <p key={i} class="note">{n}</p>)}
      <SpellPanel cypher={a.cypher_used} />
    </div>
  );
}
