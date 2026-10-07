import { Title } from '../components/bits';
import { ImportanceRune } from '../components/Results';
import { applicationCoverage } from '../lib/engine/coverage';
import { requirementsFor } from '../lib/engine/feasibility';
import { fmtRange, prettyProp } from '../lib/format';
import { href } from '../lib/router';
import type { Atlas } from '../lib/snapshot';

export function Quests({ atlas }: { atlas: Atlas }) {
  const apps = atlas.snap.applications
    .map((app) => {
      const tagged = atlas.snap.materials.filter((m) => m.used_in.some((u) => u.application === app.name));
      const { reqs, level } = requirementsFor(atlas, app.name);
      const cov = applicationCoverage(atlas, app.name);
      const avg = cov.length ? Math.round(cov.reduce((s, r) => s + r.coverage_pct, 0) / cov.length) : 0;
      return { app, tagged, reqs, level, avg };
    })
    .sort((a, b) => b.tagged.length - a.tagged.length);

  return (
    <div class="page">
      <Title lex="quests">Feasibility studies</Title>
      <p class="lede">
        Each application sets requirement targets. A study checks a material against them using every value in the graph, tells you which targets are met,
        missed, missing or disputed, and refuses to guess when the data is not there.
      </p>
      <div class="quest-grid">
        {apps.map(({ app, tagged, reqs, level, avg }) => (
          <a key={app.name} class={`quest-card ${tagged.length ? '' : 'is-empty'}`} href={href.quest(app.name)}>
            <span class="quest-name">{app.name}</span>
            <span class="quest-kinds muted">{app.kinds.join(' · ') || 'any'}</span>
            <ul class="quest-reqs">
              {reqs.slice(0, 3).map((r) => (
                <li key={r.property_type}><ImportanceRune importance={r.importance} /> {prettyProp(r.property_type)} <span class="muted">{fmtRange(r.target_min, r.target_max, atlas.props.get(r.property_type)?.unit)}</span></li>
              ))}
              {!reqs.length && <li class="muted">no targets yet</li>}
            </ul>
            <span class="quest-foot">
              <span>{tagged.length} candidate{tagged.length === 1 ? '' : 's'}</span>
              <span class="muted">{level === 'domain' ? 'domain-level targets' : `${avg}% data coverage`}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
