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

/** A token plainly not real, for pictures, which are kept and shared. */
export const PLACEHOLDER_TOKEN = 'lww_EXAMPLE-TOKEN-NOT-REAL'

/**
 * Shows PLACEHOLDER_TOKEN wherever a new token would be shown. The server
 * still makes a real one, which never reaches the page.
 */
export async function showPlaceholderToken(page: Page): Promise<void> {
  await page.route('**/api/actions/create_widget_token', async (route) => {
    const response = await route.fetch()
    const { result } = (await response.json()) as { result: object }
    await route.fulfill({ response, json: { result: { ...result, token: PLACEHOLDER_TOKEN } } })
  })
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

/**
 * A widget token that looks freshly made, answered without making one, so no
 * token is left behind: the page then shows the parameter it shows only once.
 */
export async function revealWidgetToken(page: Page) {
  const made = { name: 'Widget', createdAt: new Date().toISOString(), lastUsedAt: null }
  await page.route('**/api/actions/get_widget_token', (route) =>
    route.fulfill({ json: { result: made } }),
  )
  await page.route('**/api/actions/create_widget_token', (route) =>
    route.fulfill({ json: { result: { ...made, token: PLACEHOLDER_TOKEN } } }),
  )
  await page.getByRole('button', { name: 'Create the widget token' }).click()
  await expect(page.getByLabel('Widget parameter')).toBeVisible()
}
