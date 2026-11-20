// Stands in for parts of the settings as one page sees them, leaving the
// install's own saved settings alone, so no later test finds them changed.
// Every change on a page goes through one route, since a second route that
// fetched for itself would skip the first: a theme and a layout apply together.

import type { Page } from '@playwright/test'

type Settings = Record<string, unknown>
type Change = (settings: Settings) => Settings

const changes = new WeakMap<Page, Change[]>()

/** Applies this change to the settings this page reads, and to what a save answers with. */
export async function patchSettings(page: Page, change: Change): Promise<void> {
  const known = changes.get(page)
  if (known) {
    known.push(change)
    return
  }
  const list = [change]
  changes.set(page, list)
  // Saving any setting answers with them all, so that answer is changed too.
  for (const action of ['get_settings', 'update_settings']) {
    await page.route(`**/api/actions/${action}`, async (route) => {
      try {
        const response = await route.fetch()
        if (!response.ok()) return await route.fulfill({ response })
        const { result } = (await response.json()) as { result: Settings }
        const changed = list.reduce((settings, one) => one(settings), result)
        await route.fulfill({ response, json: { result: changed } })
      } catch (error) {
        // A read still on its way as the test ends has no page left to answer:
        // its response is disposed with the page.
        if (page.isClosed() || /disposed|closed/i.test(String(error))) return
        throw error
      }
    })
  }
}
