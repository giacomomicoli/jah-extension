import { defineConfig } from '@playwright/test';

// Run `npm run test:e2e:firefox`: it builds dist-firefox/ first, then installs it in Firefox.
export default defineConfig({
  testDir: 'test/e2e-firefox',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
