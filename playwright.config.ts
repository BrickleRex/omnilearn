import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1, // tests share the server's data dir; keep them serial
  use: {
    baseURL: 'http://localhost:4655',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run e2e:boot',
    url: 'http://localhost:4655/api/health',
    reuseExistingServer: false,
    stdout: 'pipe',
    timeout: 180_000,
    env: { OMNILEARN_DATA: 'data-e2e' },
  },
});
