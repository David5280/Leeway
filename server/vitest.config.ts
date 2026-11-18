import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Database tests share one Postgres database, so files run one at a time.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Process entry points: they only wire things together and are smoke-tested by hand.
      exclude: ['src/index.ts', 'src/cli/**', 'src/db/migrate-cli.ts'],
      // These only ever go up (CONTRIBUTING.md).
      thresholds: { statements: 99, branches: 98, functions: 99, lines: 99 },
    },
  },
})
