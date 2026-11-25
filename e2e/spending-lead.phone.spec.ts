// Spending's lead on every phone size, upright and sideways, this period and
// the last: the card fits the screen, its title is never cut, and the sum's
// amounts line up on one right edge, each clear of its name. It stands where
// the old summary cards' phone check stood.

import { expect, test, type Page } from '@playwright/test'
import { boxes, overflow, overlapping, PHONES } from './phone'
import { action } from './seed'

/** The lead, named for its period: "Spent this month", "Spent in October 2026". */
const leadCard = (page: Page) => page.getByRole('region', { name: /^Spent (this|in) / })

/** Checks the lead on the screen size the page has now. */
async function checkLead(page: Page, where: string) {
  const lead = leadCard(page)
  const sum = lead.getByRole('group', { name: 'How your budgets add up' })
  await expect(sum, where).toBeVisible()
  const width = page.viewportSize()!.width
  const card = (await lead.boundingBox())!
  expect(card.x, where).toBeGreaterThanOrEqual(0)
  expect(card.x + card.width, where).toBeLessThanOrEqual(width)
  expect(await overflow(page), where).toBeLessThanOrEqual(0)
  // The title wraps if it must, but never spills out of its box.
  const titleCut = await lead
    .locator('.section-head h2')
    .evaluate((title) => title.scrollWidth > title.clientWidth)
  expect(titleCut, where).toBe(false)
  const names = await boxes(sum.locator('.playbook-row-words'))
  const amounts = await boxes(sum.locator('.num'))
  expect(amounts.length, where).toBe(3)
  const rights = new Set(amounts.map((box) => Math.round(box.x + box.width)))
  expect(rights.size, where).toBe(1)
  names.forEach((name, i) => expect(overlapping(name, amounts[i]!), where).toBe(false))
}

test('the lead fits every phone and its sum lines up, now and looking back', async ({
  page,
  request,
}) => {
  // A long name and a large budget, so the widest figures the sum can hold are drawn.
  const { id } = await action<{ id: string }>(request, 'create_category', {
    name: 'Lead check groceries',
    budgetCents: 123_456_789,
  })
  try {
    for (const address of ['/spending', '/spending?period=-1']) {
      await page.goto(address)
      for (const [name, viewport] of PHONES) {
        await page.setViewportSize(viewport)
        await checkLead(page, `${address} on ${name}`)
      }
    }
  } finally {
    await action(request, 'delete_category', { id })
  }
})
