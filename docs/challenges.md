# Challenge tracker

The site's front page is now a tracker of energy-transition challenges. Each challenge is one
JSON file rendered as a page with: the problem in numbers, why it is hard, a technology radar
(Adopt / Trial / Assess / Hold), where AI can help, open questions, a changelog, the sources
and, optionally, a simulator. The battery-materials atlas moved to `#/atlas` and keeps working.

## Published

| Slug | Title | Simulator |
|---|---|---|
| `home-heating` | Heating and cooling homes without burning gas | boiler vs heat pump vs hybrid: yearly cost and CO2 |

Planned next: ceramic kilns (cutting gas in tile firing), thermal storage, domestic and community batteries.

## Rules

- Every figure and every technology cites at least one source id from the file's `sources` list.
- Statements without a source carry `"editorial": true`: they are the author's judgement and the page labels them.
- Sources need an https URL and a date (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`); unused sources fail the tests.
- Ring meanings: **Adopt** mature and the default where it fits; **Trial** works, results depend on context;
  **Assess** lab or prototype stage; **Hold** avoid for new projects (regulation, cost or evidence).
- Simulator defaults that are physical constants or official factors cite their source in code comments;
  prices are labelled as examples the visitor should replace.

These rules are enforced by `web/src/lib/challenges/challenges.test.ts`.

## Adding a challenge

1. Create `web/src/data/challenges/<slug>.json` following `web/src/lib/challenges/types.ts`.
2. Register it in `web/src/lib/challenges/index.ts`.
3. Optional simulator: a pure function in `web/src/lib/challenges/` with unit tests, a component in
   `web/src/components/`, and a new value for the `simulator` field.
4. Add a line to the challenge's `changelog` on every update.
5. `cd web && npm test && npm run build && npx playwright test`.

## Files

- `web/src/lib/challenges/types.ts`: data model and ring definitions
- `web/src/lib/challenges/heating-sim.ts`: home heating simulator (Carnot-based SCOP estimate, cost, CO2, break-even price)
- `web/src/views/Challenges.tsx`, `web/src/views/Challenge.tsx`: list and detail pages
- `web/src/components/Radar.tsx`, `web/src/components/HeatingSimulator.tsx`
