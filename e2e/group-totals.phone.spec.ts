// Each group heading in Wealth's accounts ends in the group's total. On every phone
// size, upright and sideways, the figure sits on the title's row, clear of
// the title, never cut short, and the title stays on one line.

import { expect, test, type Page } from '@playwright/test'
import { PHONES } from './phone'
import { action } from './seed'

/** Where each heading's title and total sit, and whether either broke or was cut. */
const headings = (page: Page) =>
  page.locator('.acct-group .section-head').evaluateAll((heads) =>
    heads.map((head) => {
      const title = head.querySelector('h2')!
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
        titleLines: new Set([...lines.getClientRects()].map((line) => Math.round(line.top))).size,
        totalCut: total.scrollWidth > total.clientWidth,
        totalLines: totalBox.height > 2 * parseFloat(getComputedStyle(total).fontSize),
      }
    }),
  )

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
    await page.goto('/wealth')
    await expect(page.getByRole('region', { name: 'Credit cards' })).toContainText('owed')
    for (const [name, viewport] of PHONES) {
      await page.setViewportSize(viewport)
      const measured = await headings(page)
      expect(measured.length, name).toBeGreaterThanOrEqual(3)
      for (const heading of measured) {
        const where = `${heading.title} on ${name}`
        expect(heading.total, where).toMatch(/\d/)
        expect(heading.sameRow, where).toBe(true)
        expect(heading.gap, where).toBeGreaterThanOrEqual(0)
        expect(heading.rowRight, where).toBeGreaterThanOrEqual(0)
        expect(heading.titleLines, where).toBe(1)
        expect(heading.totalCut, where).toBe(false)
        expect(heading.totalLines, where).toBe(false)
      }
    }
  } finally {
    for (const { id } of accounts) await action(request, 'delete_account', { id })
  }
})
