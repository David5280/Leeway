// Two alerts on one account, on a phone: the regression an owner's iPhone
// showed. A tapped alert row kept its hover background (a touch screen keeps
// :hover on what was tapped), and the row reached past its tight card, so the
// stuck background looked like a second card drawn over the first.

import { expect, test } from '@playwright/test'
import { action } from './manual'

test('a tapped alert row stays inside its card and paints nothing once let go', async ({
  page,
}) => {
  const { id } = await action<{ id: string }>(page, 'create_account', {
    name: 'Phone checking (second checking)',
    type: 'depository',
    balanceCents: -14_210,
  })
  try {
    // Yesterday in UTC, which is never ahead of the app's own day: an evening in
    // Denver is already tomorrow in UTC, and a fee dated tomorrow is not yet counted.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    for (let fee = 0; fee < 2; fee++) {
      await action(page, 'create_transaction', {
        accountId: id,
        date: yesterday,
        name: 'OVERDRAFT FEE',
        amountCents: 3_400,
      })
    }

    // Alerts show on the account's own page only.
    await page.goto(`/wealth/accounts/${id}`)
    const card = page.getByRole('region', { name: 'Alerts for this account' })
    const rows = card.getByRole('link')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('is overdrawn by $142.10')
    await expect(rows.nth(1)).toContainText('was charged 2 overdraft fees')

    // The pointer rests on the second row, as a finger leaves it after a tap.
    await rows.nth(1).hover()
    const cardBox = (await card.boundingBox())!
    for (const row of await rows.all()) {
      const box = (await row.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x)
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
      expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        'rgba(0, 0, 0, 0)',
      )
    }
    // The first row's alert still shows in full, nothing drawn over it.
    await expect(rows.nth(0)).toBeVisible()
  } finally {
    await action(page, 'delete_account', { id })
  }
})
