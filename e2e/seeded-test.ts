// The phone layout guard's test (layout-guard.phone.spec.ts): Playwright's,
// with long names in every list for as long as a worker runs its tests.

import { test as base } from '@playwright/test'
import { emptySeed, removeSeed, seedEveryScreen, type Seeded } from './seed'

/**
 * The seed is added once per worker, before its first test, and removed when
 * the worker ends, rather than around a describe block. Playwright gives the
 * files using this test workers of their own, since no plain test has this
 * fixture, so no other file sees the seed. That leaves each test standing
 * alone, so a sharded run can put it in any shard.
 */
export const test = base.extend<object, { seeded: Seeded }>({
  seeded: [
    async ({ playwright }, use, workerInfo) => {
      // The signed-in owner of the project's server, as the request fixture has it.
      const { baseURL, storageState } = workerInfo.project.use
      const request = await playwright.request.newContext({ baseURL, storageState })
      const seeded = emptySeed()
      try {
        await seedEveryScreen(request, seeded)
        await use(seeded)
      } finally {
        // However far the seed got, so a seed that fails halfway still cleans up.
        await removeSeed(request, seeded)
        await request.dispose()
      }
    },
    { scope: 'worker', auto: true },
  ],
})
