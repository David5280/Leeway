// Every screen loads cleanly: no script errors, no failed API calls, and
// nothing fetched from another server (fonts included), since Leeway is
// meant to keep everything on the owner's own server. Nothing the page does
// may break its Content Security Policy either.

import { expect, test } from '@playwright/test'

const SCREENS = [
  { path: '/', heading: /to/ },
  { path: '/transactions', heading: 'Activity' },
  { path: '/transactions/import', heading: 'Import transactions' },
  { path: '/budgets', heading: 'Budgets' },
  { path: '/plan', heading: 'Plan' },
  { path: '/plan/goals', heading: 'Plan' },
  { path: '/plan/debts', heading: 'Plan' },
  { path: '/plan/net-worth', heading: 'Plan' },
  { path: '/plan/retirement', heading: 'Plan' },
  { path: '/settings/appearance', heading: 'Settings' },
  { path: '/settings/budgeting', heading: 'Settings' },
  { path: '/settings/banks', heading: 'Settings' },
  { path: '/settings/assistant', heading: 'Settings' },
  { path: '/settings/ai', heading: 'Settings' },
  { path: '/settings/widget', heading: 'Settings' },
]

for (const { path, heading } of SCREENS) {
  test(`${path} loads cleanly`, async ({ page, baseURL }) => {
    const problems: string[] = []
    page.on('pageerror', (error) => problems.push(`script error: ${error.message}`))
    // The browser reports a blocked script, style or request as a console error.
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
        problems.push(`blocked by the policy: ${message.text()}`)
      }
    })
    page.on('request', (request) => {
      if (!request.url().startsWith(baseURL!) && !request.url().startsWith('data:')) {
        problems.push(`outside request: ${request.url()}`)
      }
    })
    page.on('response', (response) => {
      if (response.status() >= 400) problems.push(`${response.status()} from ${response.url()}`)
    })

    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(problems).toEqual([])
  })
}
