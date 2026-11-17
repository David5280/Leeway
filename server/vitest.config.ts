import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Database tests share one Postgres database, so files run one at a time.
    fileParallelism: false,
  },
})
