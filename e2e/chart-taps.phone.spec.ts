// On a phone a finger on an Overview chart reads the chart: the readout shows
// under it and no sheet opens. The title and figure above the chart are what
// open the drill-down.

import { expect, test } from '@playwright/test'
import { showWidgets } from './dashboard'
import { emptySeed, removeSeed, seedEveryScreen, type Seeded } from './seed'

const CHARTS = [
  { region: 'Spending pace', title: /Flexible spending pace/ },
  { region: 'Money in and out', title: /Are you spending less than you earn/ },
]

test.describe('Overview charts under a finger', () => {
  // Spending to draw, added for these tests only and taken away after.
  const seeded: Seeded = emptySeed()
  test.beforeAll(async ({ request }) => {
    await seedEveryScreen(request, seeded)
  })
  test.afterAll(async ({ request }) => {
    await removeSeed(request, seeded)
    Object.assign(seeded, emptySeed())
  })

  for (const chart of CHARTS) {
    test(`${chart.region}: a tap on the chart reads it, and the title opens the sheet`, async ({
      page,
    }) => {
      await showWidgets(page, ['pace', 'flows'])
      await page.goto('/')
      const card = page.getByRole('region', { name: chart.region, exact: true })
      const plot = card.getByTestId('chart-hit')
      // In the middle of the screen, clear of the header and the tab bar over the page.
      await plot.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      const box = (await plot.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await expect(card.locator('.chart-readout')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await card.getByRole('button', { name: chart.title }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    })
  }
})
