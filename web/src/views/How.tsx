import { useEffect, useRef, useState } from 'preact/hooks';
import { Title } from '../components/bits';
import { href } from '../lib/router';

const STEPS = [
  { id: 'discover', station: 'Discover', title: 'Ask the libraries, not the open web',
    body: 'The harvester queries licensed, structured sources: OpenAlex, Semantic Scholar, CrossRef and arXiv for papers and abstracts; Materials Project and OPTIMADE databases (OQMD, JARVIS) for computed properties; a curated dataset of measured solid-electrolyte conductivities; PubChem for molecule identifiers. No general crawling, no paywalled text.' },
  { id: 'fetch', station: 'Open text', title: 'Read only what may be read',
    body: 'Unpaywall, Europe PMC and arXiv point to open-access copies. A PDF is downloaded and chunked only when its licence is Creative Commons; everything else stays abstract-only.' },
  { id: 'extract', station: 'Extract', title: 'A local model proposes, it does not decide',
    body: 'An open model running locally (LM Studio) reads each abstract or passage and returns strict JSON: materials, numeric values with units and conditions, application tags and stated open problems. Every item must carry a verbatim quote.' },
  { id: 'validate', station: 'Validate', title: 'Cheap, explainable checks',
    body: 'The quote must appear word for word in the text. Units are normalised (mS/cm becomes S/cm). Values outside a plausible range are flagged. Formulas resolve through an alias table and pymatgen; doped variants are linked to their parent phase.' },
  { id: 'stage', station: 'Stage', title: 'A queue, not the graph',
    body: 'Candidates wait in a reviewable queue on disk. Nothing has touched the knowledge graph yet.' },
  { id: 'review', station: 'Review gate', title: 'The portcullis only a human can open',
    body: 'A person accepts, rejects or edits each candidate. There is deliberately no auto-accept. AI-derived links that are written before review carry confirmed = false and are shown as “awaiting review” everywhere on this site.' },
  { id: 'commit', station: 'Commit', title: 'Into the graph, with provenance',
    body: 'Accepted candidates become graph facts with their source, source type, conditions and quote. They are also mirrored to a git-tracked file, which makes the curated dataset itself reviewable.' },
  { id: 'ask', station: 'Ask', title: 'Questions answered with receipts',
    body: 'A GraphRAG agent routes each question to a deterministic tool (screening, feasibility, composition, coverage, literature), retrieves supporting sources, and writes an answer in which every number must cite its source. Citations that are not in the retrieved data are stripped.' },
];

export function How() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);

  const n = STEPS.length;
  const xs = STEPS.map((_, i) => 40 + (i * 520) / (n - 1));
  const reviewIdx = STEPS.findIndex((s) => s.id === 'review');
  const passed = active > reviewIdx;

  return (
    <div class="page how-page">
      <Title lex="how">How the data is gathered</Title>
      <p class="lede">From a library shelf to a cited answer, in eight stations. Scroll to follow one candidate fact through the pipeline.</p>
      <div class="scrolly">
        <div class="scrolly-figure" aria-hidden="true">
          <svg viewBox="0 0 600 190" class="pipeline">
            <path d={`M${xs[0]} 95 ${xs.map((x) => `L${x} 95`).join(' ')}`} class="pipe-track" />
            <path d={`M${xs[0]} 95 L${xs[active]} 95`} class="pipe-done" />
            {STEPS.map((s, i) => (
              <g key={s.id} class={`station ${i <= active ? 'is-done' : ''} ${i === active ? 'is-active' : ''} station-${s.id}`}>
                {s.id === 'review' ? (
                  <g class={`gate ${passed ? 'is-open' : ''}`}>
                    <rect x={xs[i] - 16} y={70} width={32} height={50} rx={3} class="gate-frame" />
                    <g class="gate-bars">
                      {[-9, -3, 3, 9].map((dx) => <line key={dx} x1={xs[i] + dx} y1={72} x2={xs[i] + dx} y2={118} />)}
                    </g>
                  </g>
                ) : (
                  <circle cx={xs[i]} cy={95} r={i === active ? 13 : 9} />
                )}
                <text x={xs[i]} y={i % 2 ? 150 : 34} text-anchor="middle">{s.station}</text>
              </g>
            ))}
            <g class="token" style={{ transform: `translate(${xs[active]}px, 0)` }}>
              <rect x={-18} y={50} width={36} height={22} rx={4} class="token-card" />
              <circle cx={0} cy={61} r={7} class={`token-seal ${passed ? 'is-sealed' : ''}`} />
              <text x={0} y={64.5} text-anchor="middle" class="token-mark">{passed ? '✓' : '?'}</text>
            </g>
          </svg>
          <p class="scrolly-caption">
            Station {active + 1} of {n}: <strong>{STEPS[active].station}</strong> · the fact is {passed ? 'confirmed' : 'not yet confirmed'}
          </p>
        </div>
        <ol class="scrolly-steps">
          {STEPS.map((s, i) => (
            <li key={s.id} ref={(r) => { refs.current[i] = r; }} data-index={i} class={`scrolly-step ${i === active ? 'is-active' : ''}`}>
              <p class="step-num">{String(i + 1).padStart(2, '0')} · {s.station}</p>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
      <div class="cta-band">
        <p>See the result: every value on this site wears its provenance stamp.</p>
        <a class="btn" href={href.atlas()}>Open the atlas</a>
      </div>
    </div>
  );
}
