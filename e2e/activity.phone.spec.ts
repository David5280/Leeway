// The Transactions list on a phone, upright and sideways: rows never overlap
// each other or their day headers, nothing in a row is cut off or runs into
// the amount, a transaction's sheet stays clear of the notch, and everything
// pressed in the filters and the sheet is at least a finger (--tap) tall.

import { expect, test, type Page } from '@playwright/test'
import { addAccount, addSpending, removeAccount } from './manual'
import { overflow, shortTargets, simulateInsets, SIDEWAYS_INSETS, UPRIGHT_INSETS } from './phone'

/** An iPhone's 390 by 844 screen, upright, and the same turned sideways. */
const UPRIGHT = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
const SIDEWAYS = { ...UPRIGHT, viewport: { width: 844, height: 390 } }

const ACCOUNT = 'Layout checking with a longer name'

/** Spending of every length, from a short name to one far too long for a row. */
const SPENDING = [
  { description: 'Snooze', amount: '18.40', category: 'Dining out' },
  { description: 'KING SOOPERS #0112', amount: '1,284.06', category: 'Groceries' },
  { description: 'Colorado Department of Revenue Motor Vehicle Registration', amount: '96.10' },
  { description: 'SQ *BLUE BOTTLE 0412', amount: '5.75', category: 'Coffee' },
]

/**
 * Everything wrong with how the rows are laid out, as sentences, so a failure
 * says what overlapped. Empty when the layout is right.
 */
function rowProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = []
    const box = (element: Element | null) => element!.getBoundingClientRect()
    const rows = [...document.querySelectorAll('.act-row')]
    rows.forEach((row, index) => {
      const name = row.querySelector('.act-row-name')!.textContent
      const r = box(row)
      if (r.left < 0 || r.right > window.innerWidth) problems.push(`${name}: row leaves the screen`)
      if (r.height < 56 || r.height > 72) problems.push(`${name}: row is ${r.height}px tall`)
      const amount = row.querySelector<HTMLElement>('.act-row-amount')!
      const a = box(amount)
      if (amount.scrollWidth > amount.clientWidth) problems.push(`${name}: amount is cut off`)
      if (a.right > r.right) problems.push(`${name}: amount runs past the row`)
      for (const part of ['.act-row-name', '.act-row-sub']) {
        if (box(row.querySelector(part)).right > a.left)
          problems.push(`${name}: ${part} hits the amount`)
      }
      if (
        box(row.querySelector('.icon-badge')).right > box(row.querySelector('.act-row-name')).left
      ) {
        problems.push(`${name}: icon hits the name`)
      }
      const next = rows[index + 1]
      if (next && r.bottom > box(next).top + 0.5) problems.push(`${name}: overlaps the next row`)
    })
    for (const day of document.querySelectorAll('.act-day')) {
      const head = box(day.querySelector('.act-day-head'))
      const first = box(day.querySelector('.act-row'))
      if (head.bottom > first.top + 0.5)
        problems.push(`${day.getAttribute('aria-label')}: header overlaps its rows`)
    }
    return problems
  })
}

test.describe('the Transactions list on a phone', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await addAccount(page, { name: ACCOUNT, balance: '2000' })
    for (const spending of SPENDING) await addSpending(page, { account: ACCOUNT, ...spending })
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await removeAccount(page, ACCOUNT)
    await page.close()
  })

  for (const [orientation, screen, insets] of [
    ['upright', UPRIGHT, UPRIGHT_INSETS],
    ['sideways', SIDEWAYS, SIDEWAYS_INSETS],
  ] as const) {
    test.describe(orientation, () => {
      test.use(screen)

      test('rows neither overlap nor cut anything off', async ({ page }) => {
        await page.goto('/transactions')
        await simulateInsets(page, insets)
        await expect(page.getByRole('button', { name: /^Snooze, spent/ })).toBeVisible()
        expect(await rowProblems(page)).toEqual([])
        expect(await overflow(page)).toBeLessThanOrEqual(0)
      })

      test("a transaction's sheet fits the screen, clear of the notch", async ({ page }) => {
        await page.goto('/transactions')
        await simulateInsets(page, insets)
        await page.getByRole('button', { name: /^King Soopers, spent/ }).click()
        const sheet = page.getByRole('dialog', { name: 'King Soopers' })
        await expect(sheet).toBeVisible()
        // Wait for the sheet to finish sliding in before measuring it.
        await expect.poll(() => sheet.evaluate((element) => element.getAnimations().length)).toBe(0)
        const { width, height } = screen.viewport
        const panel = (await sheet.boundingBox())!
        expect(panel.x).toBeGreaterThanOrEqual(0)
        expect(panel.x + panel.width).toBeLessThanOrEqual(width + 0.5)
        expect(panel.y + panel.height).toBeLessThanOrEqual(height + 0.5)
        const close = (await sheet.getByRole('button', { name: 'Close' }).boundingBox())!
        expect(close.x + close.width).toBeLessThanOrEqual(width - insets.right)
        expect(close.y).toBeGreaterThanOrEqual(insets.top)
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        await page.keyboard.press('Escape')
        await expect(sheet).toHaveCount(0)
      })

      test('everything pressed is a finger tall, in the filters and the sheet', async ({
        page,
      }) => {
        await page.goto('/transactions')
        // The guard only means something where the page sees a finger.
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
        await expect(page.getByRole('button', { name: /^Snooze, spent/ })).toBeVisible()
        expect(await shortTargets(page, '.act-filters')).toEqual([])

        await page.getByRole('button', { name: /^King Soopers, spent/ }).click()
        const sheet = page.getByRole('dialog', { name: 'King Soopers' })
        // Set by hand and added by hand, so every control the sheet can show is there.
        await expect(sheet.getByRole('button', { name: 'Let rules decide again' })).toBeVisible()
        await expect(sheet.getByRole('switch', { name: 'Leave out of totals' })).toBeVisible()
        await expect(sheet.getByRole('button', { name: 'Delete transaction' })).toBeVisible()
        await expect.poll(() => sheet.evaluate((element) => element.getAnimations().length)).toBe(0)
        expect(await shortTargets(page, '.sheet')).toEqual([])
      })
    })
  }
})
