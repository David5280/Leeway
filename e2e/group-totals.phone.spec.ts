// Each group heading in Home's accounts ends in the group's total. On every phone
// size, upright and sideways, the figure sits on the title's row, clear of
// the title, or, where the row is too narrow for both, on its own line right
// under it. Neither is ever cut short, and the title stays on one line.

import { expect, test, type Page } from '@playwright/test'
import { PHONES } from './phone'
import { action } from './seed'

/** Where each heading's title and total sit, and whether either broke or was cut. */
const headings = (page: Page) =>
  page.locator('.acct-group .section-head').evaluateAll((heads) =>
    heads.map((head) => {
      const title = head.querySelector('h2, h3')!
      const total = head.querySelector<HTMLElement>('.section-aside')!
      const lines = document.createRange()
      lines.selectNodeContents(title)
      const titleBox = title.getBoundingClientRect()
      const totalBox = total.getBoundingClientRect()
      return {
        title: title.textContent,
        total: total.textContent,
        gap: totalBox.left - titleBox.right,
        rowRight: head.getBoundingClientRect().right - totalBox.right,
        sameRow: totalBox.top < titleBox.bottom && titleBox.top < totalBox.bottom,
        under: totalBox.top >= titleBox.bottom,
        titleLines: new Set([...lines.getClientRects()].map((line) => Math.round(line.top))).size,
        totalCut: total.scrollWidth > total.clientWidth,
        totalLines: totalBox.height > 2 * parseFloat(getComputedStyle(total).fontSize),
      }
    }),
  )

type Heading = Awaited<ReturnType<typeof headings>>[number]

/** One heading on one phone: its total whole, clear of the title, and the title on one line. */
function expectFits(heading: Heading, where: string) {
  expect(heading.total, where).toMatch(/\d/)
  // Beside the title, clear of it, or on a line of its own under it: never over it.
  if (heading.sameRow) expect(heading.gap, where).toBeGreaterThanOrEqual(0)
  else expect(heading.under, where).toBe(true)
  expect(heading.rowRight, where).toBeGreaterThanOrEqual(0)
  expect(heading.titleLines, where).toBe(1)
  expect(heading.totalCut, where).toBe(false)
  expect(heading.totalLines, where).toBe(false)
}

test("each group's total fits its heading on every phone, upright and sideways", async ({
  page,
  request,
}) => {
  // Long figures: an overdraft in the millions, a card, and a large loan.
  const accounts = await Promise.all(
    [
      {
        name: 'Overdraft checking',
        type: 'depository',
        subtype: 'checking',
        balanceCents: -123_456_789,
      },
      { name: 'Totals card', type: 'credit', subtype: 'credit card', balanceCents: 507_706 },
      { name: 'Totals mortgage', type: 'loan', subtype: 'mortgage', balanceCents: 31_245_018 },
    ].map((input) => action<{ id: string }>(request, 'create_account', input)),
  )
  try {
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Credit cards' })).toContainText('owed')
    for (const [name, viewport] of PHONES) {
      await page.setViewportSize(viewport)
      const measured = await headings(page)
      expect(measured.length, name).toBeGreaterThanOrEqual(3)
      for (const heading of measured) expectFits(heading, `${heading.title} on ${name}`)
    }
  } finally {
    for (const { id } of accounts) await action(request, 'delete_account', { id })
  }
})
