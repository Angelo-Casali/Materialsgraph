import { useEffect, useMemo, useState } from 'preact/hooks';
import { Formula, Seal, StatusPill, Title } from '../components/bits';
import { FeasibilityGauge, FeasibilityTable, GapsPanel, ImportanceRune, VerdictBanner } from '../components/Results';
import { MaterialSearch } from '../components/Search';
import { applicationCoverage } from '../lib/engine/coverage';
import { assess, requirementsFor, verdictTone, type Feasibility } from '../lib/engine/feasibility';
import { fmtRange, prettyProp } from '../lib/format';
import { href } from '../lib/router';
import type { Atlas } from '../lib/snapshot';
import { NotFound } from './NotFound';

const TONE_ORDER = { good: 0, warning: 1, unknown: 2, critical: 3 } as const;

export function Quest({ atlas, app, preselect }: { atlas: Atlas; app: string; preselect: string | null }) {
  const application = atlas.apps.get(app);
  const [includePending, setIncludePending] = useState(true);
  const [extra, setExtra] = useState<string[]>(() => (preselect && atlas.byKey.has(preselect) ? [preselect] : []));
  const [selected, setSelected] = useState<string | null>(preselect);
  useEffect(() => {
    if (preselect && atlas.byKey.has(preselect)) {
      setSelected(preselect);
      setExtra((e) => (e.includes(preselect) ? e : [...e, preselect]));
    }
  }, [preselect, atlas]);

  const { reqs, level } = useMemo(() => requirementsFor(atlas, app), [atlas, app]);
  const candidates = useMemo(() => {
    const keys = new Set(atlas.snap.materials.filter((m) => m.used_in.some((u) => u.application === app)).map((m) => m.key));
    extra.forEach((k) => keys.add(k));
    const out = [...keys].map((k) => assess(atlas, k, app, { includeUnconfirmed: includePending })).filter((f): f is Feasibility => !!f);
    return out.sort((a, b) => {
      const t = TONE_ORDER[verdictTone(a.verdict)] - TONE_ORDER[verdictTone(b.verdict)];
      if (t) return t;
      return b.rows.filter((r) => r.status === 'met').length - a.rows.filter((r) => r.status === 'met').length;
    });
  }, [atlas, app, extra, includePending]);
  const coverage = useMemo(() => applicationCoverage(atlas, app), [atlas, app]);

  if (!application) return <NotFound />;
  const current = candidates.find((c) => c.materialKey === selected) ?? candidates[0] ?? null;
  const currentMat = current ? atlas.byKey.get(current.materialKey) : null;
  const gaps = atlas.snap.gaps.filter((g) => !g.application || g.application === app);

  return (
    <div class="page quest-page">
      <nav class="crumbs" aria-label="Breadcrumb"><a href={href.quests()}>Feasibility studies</a> <span aria-hidden="true">›</span> <span aria-current="page">{app}</span></nav>
      <Title lex="quest">Feasibility study: {app}</Title>
      {application.description && <p class="lede">{application.description}</p>}

      <section class="quest-brief" aria-labelledby="req-h">
        <h2 id="req-h">Requirements</h2>
        {level === 'domain' && <p class="small muted">This application has no targets of its own yet, so the Battery domain's targets apply.</p>}
        {reqs.length ? (
          <ul class="req-list">
            {reqs.map((r) => (
              <li key={r.property_type}>
                <ImportanceRune importance={r.importance} />
                <span class="req-name">{prettyProp(r.property_type)}</span>
                <span class="req-target">{fmtRange(r.target_min, r.target_max, atlas.props.get(r.property_type)?.unit)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">No requirement targets are defined for this application yet.</p>
        )}
        <p class="small muted">Targets are illustrative and reviewer-editable (graph/reference.py). Values are compared using the best available evidence: reviewed first, then measured over computed.</p>
      </section>

      <section aria-labelledby="board-h">
        <div class="section-head">
          <h2 id="board-h">Candidates</h2>
          <label class="switch">
            <input type="checkbox" checked={includePending} onChange={(e) => setIncludePending((e.target as HTMLInputElement).checked)} />
            <span>Include evidence awaiting review</span>
          </label>
        </div>
        <div class="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
          <table class="leaderboard">
            <thead>
              <tr>
                <th scope="col">Material</th>
                {reqs.map((r) => <th scope="col" key={r.property_type}>{prettyProp(r.property_type)}</th>)}
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const m = atlas.byKey.get(c.materialKey)!;
                const tag = m.used_in.find((u) => u.application === app);
                const isSel = current?.materialKey === c.materialKey;
                return (
                  <tr key={c.materialKey} class={isSel ? 'is-selected' : ''}>
                    <th scope="row">
                      <button class="linklike" aria-pressed={isSel} onClick={() => setSelected(c.materialKey)}>
                        <Formula f={m.formula} />{m.common_name ? <span class="muted"> {m.common_name}</span> : null}
                      </button>
                      {tag ? (!tag.confirmed && <span class="tag-pending"> <Seal confirmed={false} size={14} /> tag pending</span>) : <span class="muted small"> (not tagged)</span>}
                    </th>
                    {c.rows.map((r) => <td key={r.property_type}><StatusPill status={r.status} compact /></td>)}
                    <td><span class={`tone tone-${verdictTone(c.verdict)}`}>{shortVerdict(c.verdict)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div class="test-any">
          <MaterialSearch atlas={atlas} id="quest-search" label="Test any material against this study" onPick={(m) => { setExtra((e) => (e.includes(m.key) ? e : [...e, m.key])); setSelected(m.key); }} />
        </div>
      </section>

      {current && currentMat && (
        <section class="assessment" aria-labelledby="assess-h">
          <div class="assessment-head">
            <h2 id="assess-h">Assessment: <a href={href.material(currentMat.key)}><Formula f={currentMat.formula} /></a></h2>
            <FeasibilityGauge rows={current.rows} />
          </div>
          <VerdictBanner verdict={current.verdict} />
          <FeasibilityTable rows={current.rows} atlas={atlas} />
          <p class="small muted">Computed in your browser from the published snapshot with the same rules as the graph's feasibility tool (parity-tested against the Python implementation).</p>
        </section>
      )}

      <section aria-labelledby="cov-h">
        <h2 id="cov-h">What we know, and what is still fog</h2>
        <GapsPanel coverage={coverage.map((r) => ({ ...r }))} gaps={gaps} sample={atlas.snap.meta.sample} />
      </section>
    </div>
  );
}

function shortVerdict(v: string): string {
  if (v.startsWith('feasible')) return 'Feasible on data';
  if (v.startsWith('requirements not met')) return 'Not met';
  if (v.startsWith('sources disagree')) return 'Disputed';
  if (v.startsWith('insufficient')) return 'Insufficient data';
  return 'No targets';
}
