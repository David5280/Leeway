// On a phone a finger on a chart reads the chart: the readout shows under it
// and no sheet opens. Spending pace is on Spending, money in and out on
// Savings. The title and figure above the chart are what open the
// drill-down. A finger that starts on a chart to scroll the page leaves no
// readout behind.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { action, emptySeed, removeSeed, seedEveryScreen, type Seeded } from './seed'

const CHARTS = [
  {
    region: 'Spending pace',
    page: '/spending',
    title: /Flexible spending pace/,
    reads: async (readout: Locator) => {
      await expect(readout).toContainText(/\$[1-9][\d,]* spent/)
    },
  },
  {
    region: 'Money in and out',
    page: '/wealth/savings',
    title: /Are you spending less than you earn/,
    reads: async (readout: Locator) => {
      // At least the $3,000 paycheck filed below came in (the seed's unfiled pay may add to it).
      const moneyIn = /\$([\d,]+) in/.exec(await readout.innerText())
      expect(Number(moneyIn?.[1]?.replaceAll(',', ''))).toBeGreaterThanOrEqual(3_000)
      // Unfiled pay is money in, never negative spending.
      await expect(readout).toContainText(/\$[\d,]+ out/)
      await expect(readout).not.toContainText(/[−-]\$[\d,]+ out/)
    },
  },
]

test.describe('charts under a finger', () => {
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
      const { card, centre } = await openChart(page, chart)
      await page.touchscreen.tap(centre.x, centre.y)
      const readout = card.locator('.chart-readout')
      await expect(readout).toBeVisible()
      await chart.reads(readout)
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await card.getByRole('button', { name: chart.title }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    })

    test(`${chart.region}: a scroll that starts on the chart leaves no readout`, async ({
      page,
    }) => {
      const { card, plot, centre } = await openChart(page, chart)
      const before = await page.evaluate(() => window.scrollY)
      await swipeDown(page, centre)
      // The page really scrolled back up, so the browser took the touch over.
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(before)
      await expect(plot).toBeAttached()
      await expect(card.locator('.chart-readout')).toHaveCount(0)
    })
  }
})

/** Opens the chart's page with its card centred, clear of the header and tab bar. */
async function openChart(page: Page, { region, page: address }: { region: string; page: string }) {
  await page.goto(address)
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
