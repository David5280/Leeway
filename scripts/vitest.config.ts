import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../coverage/scripts',
      include: ['e2e/**/*.ts'],
      // The entry point only wires the parts together; every sharded run exercises it.
      exclude: ['e2e/cli.ts', '**/*.test.ts'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})
