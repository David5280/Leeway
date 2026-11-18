// Browser tests: a real build of Leeway, a real database and a real browser.
// Run with `npm run e2e` after `npm run build`. See CONTRIBUTING.md.

import { defineConfig, devices } from '@playwright/test'
import { SETUP_CODE } from './e2e/owner'

// E2E_PORT lets a second checkout run its tests while another holds 3100.
const PORT = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: 'e2e',
  // Every test shares one install, so they run in order, one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'America/Denver',
  },
  projects: [
    // First-run setup creates the owner and saves the signed-in session for the rest.
    { name: 'setup', testMatch: /setup\.spec\.ts/, use: devices['Desktop Chrome'] },
    {
      name: 'desktop',
      testIgnore: /(setup|phone)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/owner.json' },
    },
    {
      name: 'phone',
      testMatch: /phone\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/owner.json' },
    },
  ],
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/leeway_e2e',
      // A fixed key is fine here: the database is wiped on every run.
      ENCRYPTION_KEY: 'e2e0'.repeat(16),
      SYNC_INTERVAL_MINUTES: '0',
      SETUP_CODE,
    },
  },
})
