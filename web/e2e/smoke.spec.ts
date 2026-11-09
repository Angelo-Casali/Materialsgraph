import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const MOCK = 'https://mg-api.mock';
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/screenshots';

async function apiDown(page: Page) {
  await page.route(`${MOCK}/**`, (r) => r.abort('connectionrefused'));
}

async function apiAwake(page: Page) {
  await page.route(`${MOCK}/api/health**`, (r) => r.fulfill({ json: { status: 'ok', version: 't', public_mode: true, db: 'ok', llm: 'configured', embeddings: 'off', sample: true } }));
  await page.route(`${MOCK}/api/tools/feasibility`, (r) =>
    r.fulfill({
      json: {
        use_case: 'feasibility', notes: [], source_ids: ['sample:illustrative'], cypher: ['MATCH (m:Material {material_key: $k}) ...'], citations: [], elapsed_ms: 87,
        extra: { verdict: 'feasible on available data (all high-importance targets met)', material: { material_key: 'sample:LiFePO4' } },
        rows: [{ property_type: 'voltage', unit: 'V', target_min: 3, target_max: 4.6, importance: 'high', level: 'application', status: 'met', values: [{ value: 3.45, unit: 'V', source_type: 'measured', confirmed: true, conditions: '', source_id: 'sample:illustrative' }] }],
      },
    }),
  );
  await page.route(`${MOCK}/api/ask`, (r) =>
    r.fulfill({
      json: {
        degraded: false, route: null, llm_provider: 'https://api.groq.com/openai/v1#free-model',
        answer: { question: 'q', use_case: 'feasibility', text: 'LFP sits at 3.45 V [sample:illustrative], inside the 3.0–4.6 V target.\n\nConfidence: measured, reviewed.', citations: [{ source_id: 'sample:illustrative', title: 'MaterialsGraph illustrative sample' }], confidence_notes: [], cypher_used: ['MATCH ...'], rows: [] },
      },
    }),
  );
}

const ROUTES: [string, string, RegExp][] = [
  ['challenges', '#/', /Energy-transition problems, measured and sourced/],
  ['challenge', '#/c/home-heating', /Heating and cooling homes without burning gas/],
  ['atlas', '#/atlas', /Explore battery materials/],
  ['atlas-selected', '#/atlas?el=Li,O', /materials? containing Li \+ O/],
  ['passport', '#/m/sample%3ALi7La3Zr2O12', /LLZO/],
  ['passport-molecule', '#/m/sample%3Amol%3Aec', /EC/],
  ['quests', '#/quests', /Feasibility studies/],
  ['quest', '#/q/solid%20electrolyte', /Feasibility study: solid electrolyte/],
  ['ask', '#/ask', /Ask the graph/],
  ['how', '#/how', /How the data is gathered/],
  ['about', '#/about', /About this project/],
  ['notfound', '#/nowhere', /Page not found/],
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });
    for (const [name, hash, heading] of ROUTES) {
      test(`${name} renders and passes axe`, async ({ page }, info) => {
        await apiDown(page);
        await page.goto(hash);
        await expect(page.locator('main')).toContainText(heading);
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}-${name}.png`, fullPage: name !== 'how' });
        // cast: @axe-core/playwright types its own playwright-core copy
        const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      });
    }
  });
}

test('periodic table: keyboard navigation and selection', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'keyboard test runs on desktop');
  await apiDown(page);
  await page.goto('#/atlas');
  const li = page.getByRole('button', { name: /^Li, Lithium/ });
  await li.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /^Be, Beryllium/ })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(li).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^O, Oxygen/ }).click();
  await expect(page.getByRole('heading', { name: /containing Li \+ O/ })).toBeVisible();
  await expect(page).toHaveURL(/el=Li,O/);
});

test('overlays switch and fog legend appears', async ({ page }) => {
  await apiDown(page);
  await page.goto('#/atlas');
  await page.getByRole('radio', { name: /Fog of war|Data coverage/ }).click();
  await expect(page.getByText(/Share of materials with ionic conductivity data/)).toBeVisible();
  await page.getByRole('radio', { name: 'Criticality' }).click();
  await expect(page.getByText('EU CRM list 2023')).toBeVisible();
});

test('quest: test any material and see the assessment', async ({ page }) => {
  await apiDown(page);
  await page.goto('#/q/solid%20electrolyte');
  await expect(page.getByText(/sources disagree on a key requirement/).first()).toBeVisible();
  await page.getByLabel('Test any material against this study').fill('LFP');
  await page.getByRole('option', { name: /LiFePO4/ }).click();
  await expect(page.getByRole('heading', { name: /Assessment:/ })).toContainText('LiFePO');
});

test('material datasheet lists every value with its provenance', async ({ page }) => {
  await apiDown(page);
  await page.goto('#/m/sample%3ALi7La3Zr2O12');
  const rows = page.locator('.pv-table tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Measured');
  await expect(rows.first()).toContainText('pending review');
  await expect(page.locator('.pv-table')).toContainText('MaterialsGraph illustrative sample (hand-curated, approximate, not for citation)');
});

test('ask: API down -> guided builder answers from the static atlas', async ({ page }) => {
  await apiDown(page);
  await page.goto('#/ask');
  await page.getByRole('button', { name: 'Answer' }).click();
  await expect(page.getByText(/Answered in your browser from the static atlas/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Verdict' })).toBeVisible();
});

test('ask: API awake -> live tool answer and cited free-text answer', async ({ page }, info) => {
  await apiAwake(page);
  await page.goto('#/ask');
  await expect(page.getByText('Live API connected')).toBeVisible();
  await page.getByRole('button', { name: 'Answer' }).click();
  await expect(page.getByText(/Answered live by the graph API in 87 ms/)).toBeVisible();
  await page.getByRole('button', { name: /Show the spell|Show query used/ }).click();
  await expect(page.locator('.spell pre')).toBeVisible();
  await page.getByLabel('Your question').fill('Is LFP a good Li-ion cathode?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.oracle .cite').first()).toHaveText('sample:illustrative');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-light-ask-live.png`, fullPage: true });
});

test('theme switch cycles auto, dark and light', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'header layout differs on mobile');
  await apiDown(page);
  await page.goto('#/');
  const btn = page.getByRole('button', { name: /^Theme:/ });
  await btn.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await btn.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('home lists the published challenge first and links to it', async ({ page }) => {
  await apiDown(page);
  await page.goto('#/');
  await page.getByRole('link', { name: /Heating and cooling homes without burning gas/ }).click();
  await expect(page).toHaveURL(/#\/c\/home-heating/);
  await page.getByRole('button', { name: 'Sources' }).click();
  await expect(page.getByRole('heading', { name: /Sources/ })).toBeInViewport();
});

test('challenge: radar opens a technology and the simulator reacts to prices', async ({ page }) => {
  await apiDown(page);
  await page.goto('#/c/home-heating');
  await page.getByRole('button', { name: /Hydrogen boilers for homes/ }).click();
  await expect(page.getByText(/32 independent studies/)).toBeVisible();
  const verdict = page.locator('.sim-verdict');
  await expect(verdict).toContainText(/heat pump is cheaper to run/);
  await expect(page.locator('.sim-break-v')).toHaveText('0.42');
  await page.getByRole('spinbutton', { name: 'Electricity (€/kWh)' }).fill('0.9');
  await expect(verdict).toContainText(/heat pump is more expensive to run/);
});

test('legacy atlas links still open the atlas', async ({ page }) => {
  await apiDown(page);
  await page.goto('#/?el=Li,O');
  await expect(page.locator('main')).toContainText(/containing Li \+ O/);
});

test('no page scrolls sideways on a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout only');
  await apiDown(page);
  for (const [, hash] of ROUTES) {
    await page.goto(hash);
    await page.waitForTimeout(150);
    const [vw, sw] = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
    expect(sw, `${hash} is ${sw}px wide on a ${vw}px screen`).toBeLessThanOrEqual(vw);
  }
});
