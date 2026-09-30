import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BROWSER__: JSON.stringify('chrome') },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
