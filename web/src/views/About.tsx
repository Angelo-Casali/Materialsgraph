import { Title } from '../components/bits';
import { href } from '../lib/router';
import { atlas } from '../lib/snapshot';

export function About() {
  const a = atlas.value;
  return (
    <div class="page about-page narrow">
      <Title lex="atlas">About this project</Title>
      <p class="lede">
        MaterialsGraph is a personal research project: a knowledge graph over battery-materials data that keeps the provenance of every number and puts
        every machine suggestion behind a human review gate. This site is its public face.
      </p>

      <h2>Why it exists</h2>
      <p>
        Computed properties are well served by Materials Project, OQMD and friends. What is missing is the link between those numbers, the measurements
        reported in papers, what each material is actually used for, which targets an application needs, and which problems are still open, with an
        honest label on how far each piece can be trusted. The feasibility study is the payoff: “does this material meet these targets, on what evidence,
        and what don't we know yet?”
      </p>

      <h2>What is honest here, and what is not yet</h2>
      <ul>
        <li>{a?.snap.meta.sample ? 'The atlas currently shows an illustrative, hand-curated sample with rounded textbook-level values. It is labelled as such everywhere and cites no invented sources.' : 'The atlas shows an export of the real graph.'}</li>
        <li>“Computed” application tags mean a database enumerated the material for that role, not that anyone built the cell.</li>
        <li>Targets in the feasibility studies are illustrative and editable; they are not industry specifications.</li>
        <li>Answers from the language model are routed to deterministic tools and must cite sources; uncited numbers are removed.</li>
      </ul>

      <h2>Architecture, at zero cost</h2>
      <figure class="arch" tabIndex={0} aria-label="Architecture diagram (scrollable)">
        <svg viewBox="0 0 640 330" role="img" aria-labelledby="arch-t arch-d">
          <title id="arch-t">Zero-cost architecture</title>
          <desc id="arch-d">On the owner's machine: the Python pipeline, a local language model in LM Studio and Neo4j in Docker produce a JSON snapshot. GitHub Pages serves this site with the snapshot. A FastAPI service on Vercel's free tier answers live questions from a Neo4j AuraDB Free database, using free open models on Groq or OpenRouter.</desc>
          <g class="arch-zone"><rect x="10" y="10" width="300" height="150" rx="10" /><text x="24" y="32">Owner's laptop (free, local)</text></g>
          <g class="arch-box"><rect x="24" y="46" width="128" height="44" rx="6" /><text x="88" y="73" text-anchor="middle">Python pipeline</text></g>
          <g class="arch-box"><rect x="168" y="46" width="128" height="44" rx="6" /><text x="232" y="66" text-anchor="middle">LM Studio</text><text x="232" y="82" text-anchor="middle" class="sub">open local model</text></g>
          <g class="arch-box"><rect x="24" y="104" width="128" height="44" rx="6" /><text x="88" y="125" text-anchor="middle">Neo4j (Docker)</text><text x="88" y="141" text-anchor="middle" class="sub">Community</text></g>
          <g class="arch-box"><rect x="168" y="104" width="128" height="44" rx="6" /><text x="232" y="125" text-anchor="middle">mg export site</text><text x="232" y="141" text-anchor="middle" class="sub">snapshot.json</text></g>

          <g class="arch-zone"><rect x="330" y="10" width="300" height="150" rx="10" /><text x="344" y="32">Free hosting</text></g>
          <g class="arch-box hl"><rect x="344" y="46" width="272" height="44" rx="6" /><text x="480" y="66" text-anchor="middle">GitHub Pages: this site + snapshot</text><text x="480" y="82" text-anchor="middle" class="sub">works fully offline from the snapshot</text></g>
          <g class="arch-box"><rect x="344" y="104" width="128" height="44" rx="6" /><text x="408" y="125" text-anchor="middle">Vercel Hobby</text><text x="408" y="141" text-anchor="middle" class="sub">FastAPI, read-only</text></g>
          <g class="arch-box"><rect x="488" y="104" width="128" height="44" rx="6" /><text x="552" y="125" text-anchor="middle">AuraDB Free</text><text x="552" y="141" text-anchor="middle" class="sub">Neo4j graph</text></g>

          <g class="arch-box"><rect x="344" y="190" width="272" height="44" rx="6" /><text x="480" y="210" text-anchor="middle">Groq / OpenRouter free models</text><text x="480" y="226" text-anchor="middle" class="sub">router + cited synthesis; never a card on file</text></g>
          <g class="arch-box hl"><rect x="24" y="190" width="272" height="44" rx="6" /><text x="160" y="210" text-anchor="middle">You, in the browser</text><text x="160" y="226" text-anchor="middle" class="sub">explore offline · ask live when awake</text></g>

          <g class="arch-arrows">
            <path d="M232 148 L232 170 L400 170 L400 160" /><text x="316" y="184" class="sub" text-anchor="middle">commit snapshot / mg import snapshot</text>
            <path d="M160 190 L160 180 L344 70" />
            <path d="M296 212 L344 126" />
            <path d="M472 126 L488 126" />
            <path d="M408 148 L408 190" />
          </g>
          <text x="20" y="270" class="foot">Limits that keep it free: in-memory rate limits, a daily language-model budget below the free quota,</text>
          <text x="20" y="288" class="foot">read-only database sessions, no freeform Cypher in public, and a static fallback for every structured question.</text>
        </svg>
      </figure>

      <h2>Stack</h2>
      <ul class="stack">
        <li><strong>Data:</strong> Materials Project (mp-api, pymatgen), OPTIMADE, OpenAlex, Semantic Scholar, CrossRef, arXiv, Unpaywall, Europe PMC, PubChem.</li>
        <li><strong>Graph:</strong> Neo4j 5 with full-text and vector indexes; every write goes through one audited module keyed to the schema constraints.</li>
        <li><strong>Language models:</strong> local open models via LM Studio for extraction; free hosted open models only for the public question layer; Claude only for optional validation passes.</li>
        <li><strong>Query layer:</strong> LangGraph agent over typed tools, read-only Cypher validator.</li>
        <li><strong>This site:</strong> Vite, TypeScript, Preact; no tracking, no cookies; preferences stay in your browser.</li>
      </ul>

      <h2>Data licences</h2>
      <p>
        Materials Project data is CC-BY 4.0 (GNoME-derived entries are CC-BY-NC and flagged). OpenAlex metadata is CC0. PubChem is public domain.
        Only Creative-Commons full texts are chunked, and no source text is redistributed with the code. Critical-element flags come from the EU Critical
        Raw Materials list (2023) and the USGS critical minerals list (2022).
      </p>

      <p><a class="btn" href="https://github.com/Angelo-Casali/Materialsgraph">Read the source</a> <a class="btn btn-ghost" href={href.how()}>How the data is gathered</a></p>
    </div>
  );
}
