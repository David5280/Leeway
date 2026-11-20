// On a phone a finger on an Overview chart reads the chart: the readout shows
// under it and no sheet opens. The title and figure above the chart are what
// open the drill-down. A finger that starts on a chart to scroll the page
// leaves no readout behind.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { showWidgets } from './dashboard'
import { action, emptySeed, removeSeed, seedEveryScreen, type Seeded } from './seed'

const CHARTS = [
  { region: 'Spending pace', title: /Flexible spending pace/ },
  { region: 'Money in and out', title: /Are you spending less than you earn/ },
]

test.describe('Overview charts under a finger', () => {
  // Spending to draw, added for these tests only and taken away after.
  const seeded: Seeded = emptySeed()
  test.beforeAll(async ({ request }) => {
    await seedEveryScreen(request, seeded)
    // Pay filed as income, so money in and out has a month to draw (the seed leaves pay uncategorized).
    const pay = await action<{ id: string }>(request, 'create_category', {
      name: 'Pay for the chart taps',
      kind: 'income',
    })
    seeded.categories.push(pay.id)
    await action(request, 'create_transaction', {
      accountId: seeded.accounts[0],
      date: new Date().toISOString().slice(0, 10),
      name: 'Payroll',
      amountCents: -300_000,
      categoryId: pay.id,
    })
  })
  test.afterAll(async ({ request }) => {
    await removeSeed(request, seeded)
    Object.assign(seeded, emptySeed())
  })

  for (const chart of CHARTS) {
    test(`${chart.region}: a tap on the chart reads it, and the title opens the sheet`, async ({
      page,
    }) => {
      const { card, centre } = await openChart(page, chart.region)
      await page.touchscreen.tap(centre.x, centre.y)
      await expect(card.locator('.chart-readout')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await card.getByRole('button', { name: chart.title }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    })

    test(`${chart.region}: a scroll that starts on the chart leaves no readout`, async ({
      page,
    }) => {
      const { card, plot, centre } = await openChart(page, chart.region)
      const before = await page.evaluate(() => window.scrollY)
      await swipeDown(page, centre)
      // The page really scrolled back up, so the browser took the touch over.
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(before)
      await expect(plot).toBeAttached()
      await expect(card.locator('.chart-readout')).toHaveCount(0)
    })
  }
})

/** Shows the Overview with the chart's card centred, clear of the header and tab bar. */
async function openChart(page: Page, region: string) {
  await showWidgets(page, ['pace', 'flows'])
  await page.goto('/')
  const card = page.getByRole('region', { name: region, exact: true })
  const plot: Locator = card.getByTestId('chart-hit')
  await plot.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const box = (await plot.boundingBox())!
  return { card, plot, centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
}

/**
 * Drags one finger down from a point, scrolling the page back up (a card low
 * on the page may have no room to scroll further down). Playwright's
 * touchscreen only taps, so the touch goes through the Chrome DevTools protocol.
 */
async function swipeDown(page: Page, from: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: from.x, y }],
    })
  await touch('touchStart', from.y)
  for (let step = 1; step <= 10; step += 1) await touch('touchMove', from.y + step * 25)
  await touch('touchEnd', from.y + 250)
  await cdp.detach()
}
