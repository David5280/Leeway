// Every screen loads cleanly: no script errors, no failed API calls, and
// nothing fetched from another server (fonts included), since Leeway is
// meant to keep everything on the owner's own server. Nothing the page does
// may break its Content Security Policy either.

import { expect, test } from '@playwright/test'

const SCREENS = [
  { path: '/', heading: 'Home' },
  { path: '/accounts/compare', heading: 'Compare accounts' },
  { path: '/spending', heading: 'Spending' },
  { path: '/spending/activity', heading: 'Activity' },
  { path: '/spending/activity/import', heading: 'Import transactions' },
  { path: '/spending/over-time', heading: 'Spending over time' },
  { path: '/spending/merchants', heading: 'Top merchants' },
  { path: '/payday', heading: 'Payday' },
  { path: '/payday/bills', heading: 'Bills' },
  { path: '/payday/pay', heading: 'Your pay' },
  { path: '/payday/six-weeks', heading: 'Six weeks ahead' },
  { path: '/goals', heading: 'Goals' },
  { path: '/wealth', heading: 'Wealth' },
  { path: '/wealth/owned', heading: 'Things you own and owe' },
  { path: '/wealth/debts', heading: 'Debts' },
  { path: '/wealth/retirement', heading: 'Retirement' },
  { path: '/wealth/savings', heading: 'How much you save' },
  { path: '/wealth/idle-cash', heading: 'Cash that could earn more' },
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
