import { defineConfig } from '@playwright/test';

// Run `npm run test:e2e`: it builds dist/ first, then loads it as an unpacked extension.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
