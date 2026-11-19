// Shared pieces for the widget's browser tests: its Settings section, and
// where to save pictures of it when asked.

import { expect, type Page } from '@playwright/test'

/**
 * A folder to save pictures of the widget's setup and previews in, for the
 * README and for review. Unset in CI: the tests then only check.
 */
export const SCREENSHOTS = process.env.WIDGET_SCREENSHOTS

/** Opens Settings > Widget and makes a fresh token; returns the parameter shown. */
export async function makeWidgetToken(page: Page): Promise<string> {
  await page.goto('/settings/widget')
  const section = page.getByRole('region', { name: 'Widget' })
  await section.getByRole('button', { name: /Create the widget token|Make a new token/ }).click()
  const parameter = page.getByLabel('Widget parameter')
  await expect(parameter).toContainText('|lww_')
  return (await parameter.textContent())!
}

/** Revokes the token if there is one, so each test starts without. */
export async function revokeWidgetToken(page: Page): Promise<void> {
  await page.request.post('/api/actions/revoke_widget_token', { data: {} })
}

/** Makes the server say it has a public https address, as a deployed Leeway does. */
export async function deployedAt(page: Page, publicUrl: string): Promise<void> {
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), publicUrl } })
  })
}
