import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the repo at /Materialsgraph/. Override with VITE_BASE for other hosts.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/Materialsgraph/',
  plugins: [preact()],
  build: { target: 'es2020', sourcemap: false, cssCodeSplit: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
