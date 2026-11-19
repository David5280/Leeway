// The home-screen widget on a desktop: making its token in Settings, reading
// the summary with it and nothing else, revoking it, and getting the script.

import { readFile } from 'node:fs/promises'
import { expect, request as newRequest, test } from '@playwright/test'
import {
  deployedAt,
  makeWidgetToken,
  PLACEHOLDER_TOKEN,
  revokeWidgetToken,
  SCREENSHOTS,
  showPlaceholderToken,
} from './widget'

test.afterEach(async ({ page }) => revokeWidgetToken(page))

test('the widget token reads the summary, and only that, until it is revoked', async ({
  page,
  baseURL,
}) => {
  const parameter = await makeWidgetToken(page)
  const [server, token] = parameter.split('|')
  expect(server).toBe(baseURL)
  const section = page.getByRole('region', { name: 'Widget' })
  await expect(section).toContainText('shown only once')
  await expect(section).toContainText('last used never')

  // A client with nothing but the token, as Scriptable is.
  const widget = await newRequest.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  })
  try {
    const summary = await widget.get('/api/widget')
    expect(summary.status()).toBe(200)
    expect(Object.keys(await summary.json()).sort()).toEqual([
      'alerts',
      'appearance',
      'asOf',
      'budgetLeftCents',
      'currency',
      'headline',
      'locale',
      'netWorth',
      'nextBills',
      'version',
    ])
    // The token opens nothing else.
    expect((await widget.get('/api/auth/me')).status()).toBe(401)
    expect((await widget.post('/api/actions/list_accounts', { data: {} })).status()).toBe(401)
    expect((await widget.post('/mcp', { data: {} })).status()).toBe(401)

    // Signed in is not enough: the summary takes the widget token alone.
    expect((await page.request.get('/api/widget')).status()).toBe(401)

    await page.reload()
    await expect(section).not.toContainText('last used never')
    await section.getByRole('button', { name: 'Revoke the widget token' }).click()
    await expect(section).toContainText('No widget token yet.')
    expect((await widget.get('/api/widget')).status()).toBe(401)
  } finally {
    await widget.dispose()
  }
})

test('the script downloads as Leeway.js, the same as the one in the repository', async ({
  page,
}) => {
  await page.goto('/settings/widget')
  const section = page.getByRole('region', { name: 'Widget' })
  await expect(section.getByRole('button', { name: 'Copy the script' })).toBeEnabled()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('link', { name: 'Download Leeway.js' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('Leeway.js')
  const served = await readFile((await download.path())!, 'utf8')
  expect(served).toBe(await readFile('widget/leeway-widget.js', 'utf8'))
})

test('on a deployed Leeway, the parameter carries its https address', async ({ page }) => {
  await deployedAt(page, 'https://leeway.example.com')
  // The picture below is shared, so it shows a token that is plainly not real.
  await showPlaceholderToken(page)
  const parameter = await makeWidgetToken(page)
  expect(parameter).toBe(`https://leeway.example.com|${PLACEHOLDER_TOKEN}`)
  const section = page.getByRole('region', { name: 'Widget' })
  await expect(section).not.toContainText('public https address')
  if (SCREENSHOTS) {
    await page.setViewportSize({ width: 1280, height: 1400 })
    await section.screenshot({ path: `${SCREENSHOTS}/settings-widget-desktop.png` })
  }
})
