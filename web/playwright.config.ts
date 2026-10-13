import { defineConfig, devices } from '@playwright/test';

// The e2e build points VITE_API_BASE at a fake host so tests can mock every API state with page.route().
export const MOCK_API = 'https://mg-api.mock';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173/Materialsgraph/', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `VITE_API_BASE=${MOCK_API} npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4173 --strictPort`,
    url: 'http://localhost:4173/Materialsgraph/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
