# Deploying for free

Everything runs on free tiers with no card on file, so the bill is always zero. Limits change; check each console.

The static site needs only step 1. Steps 2 to 5 add the optional live API behind the Ask page.

| Piece | Service | Free-tier notes |
|---|---|---|
| Website | GitHub Pages | public repo; deployed by `.github/workflows/pages.yml` |
| API | Vercel Hobby (Python function) | non-commercial use; slim bundle (~120 MB, no torch/pymatgen) |
| Graph | Neo4j AuraDB Free | small node/relationship caps; pauses after a few days idle (daily keep-alive workflow) |
| Language model | Groq free tier, OpenRouter `:free` as fallback | tokens per minute are the real limit; the API keeps a daily budget below it |

1. **Pages.** Settings → Pages → Source = GitHub Actions. Push to `main`; the site appears at `https://<user>.github.io/Materialsgraph/` in static mode.
2. **AuraDB Free.** Create a free instance and note its URI and password. Seed it with the sample (or your export):
   ```bash
   NEO4J_URI=neo4j+s://<id>.databases.neo4j.io NEO4J_USER=neo4j NEO4J_PASSWORD=... mg import snapshot web/public/data/snapshot.json
   ```
3. **Free LLM key.** Create a Groq (or OpenRouter) API key. Pick a current free model with JSON-mode support in its console.
4. **Vercel.** Create a Hobby account, then:
   ```bash
   python scripts/assemble_api_bundle.py
   cd .build/api && npx vercel link        # creates the project; prints org and project ids in .vercel/project.json
   ```
   In the Vercel project settings add: `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `QUERY_LLM_BASE_URL`, `QUERY_LLM_API_KEY`, `QUERY_LLM_MODEL`, `QUERY_LLM_MAX_TOKENS=600`, `QUERY_LLM_TIMEOUT_S=20`, `PUBLIC_MODE=1`, `EMBEDDING_BACKEND=none`, `CORS_ORIGINS=https://<user>.github.io`. Then `npx vercel deploy --prod`.
5. **Wire it up.** In GitHub: secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (for the manual "Deploy API" workflow) and variable `API_URL=https://<project>.vercel.app`. Re-run the Pages workflow; the Ask page now shows "Live API connected".

Safety on the public API: read-only database sessions plus a Cypher validator, no freeform Cypher in public mode, bounded tool parameters, an 8 KB body cap, per-IP token buckets and a global daily language-model budget, CORS limited to the site, and a 10 s transaction timeout on every public read. (The API also supports a Cloudflare Turnstile check, but the site does not render the widget yet, so leave `TURNSTILE_SECRET` unset.) If anything is asleep or rate-limited, the site says so and answers structured questions from the snapshot.
