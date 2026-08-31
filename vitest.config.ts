import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: vitest 2.x bundles vite 5 types, which
// clash with the app's vite 6 plugin types when the configs share a file.
export default defineConfig({
  test: {
    // e2e/ is Playwright's, not vitest's
    include: ['server/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts'],
  },
});
