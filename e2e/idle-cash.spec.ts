// Cash that could earn more on Plan, Bills, from a seeded household the
// server itself finds spare cash in: its answer adds up, the card says it
// with the rate it assumes and agrees with cash until payday above it, and
// the math opens under the same name with the rounding as its own row.

import { expect, test } from '@playwright/test'
import type { IdleCash } from '../server/src/domain/idleCash'
import { removeSpareCash, seedSpareCash, type SpareCashSeed } from './idleCash'
import { action } from './seed'

const NAME = 'Cash that could earn more'

/** Whole dollars, as the app writes them. */
const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`

test.describe('cash that could earn more', () => {
  const seed: SpareCashSeed = { bills: [], accounts: [] }

  test.beforeAll(async ({ request }) => {
    await seedSpareCash(request, seed)
  })
  test.afterAll(async ({ request }) => {
    await removeSpareCash(request, seed)
  })

  test('the server finds it, with math that adds up and the rate it assumes', async ({
    request,
  }) => {
    const idle = await action<IdleCash>(request, 'get_idle_cash')
    expect(idle).toMatchObject({
      suggested: true,
      reason: null,
      checkingCents: 980_000,
      billsCents: 145_000,
      cardsOwedCents: 41_200,
      // About $40 a day of everyday spending, whatever the months' lengths,
      // keeps $2,800 or so back, leaving $7,000 and some dollars to round off.
      idleCents: 700_000,
      apyPercent: 4,
    })
    expect(idle.roundedOffCents).toBeGreaterThan(0)
    const kept =
      idle.billsCents +
      idle.spendingCents +
      idle.cardsOwedCents +
      idle.cushionCents +
      idle.roundedOffCents
    expect(idle.checkingCents - kept).toBe(idle.idleCents)
    expect(idle.idleCents % 10_000).toBe(0)
  })

  test('the card says it, under cash until payday, and opens its math', async ({
    page,
    request,
  }) => {
    const idle = await action<IdleCash>(request, 'get_idle_cash')
    await page.goto('/plan/bills')
    const cash = page.getByRole('region', { name: 'Until payday' })
    await expect(cash).toContainText(`${dollars(idle.checkingCents)} in checking`)
    await expect(cash).toContainText(`${dollars(idle.billsCents)} in bills`)

    const card = page.getByRole('region', { name: NAME })
    await expect(card).toContainText(`${dollars(idle.idleCents)} in checking isn't needed`)
    await expect(card).toContainText('In savings at an assumed 4% APY')
    await card.getByRole('button').click()
    const drill = page.getByRole('dialog', { name: NAME })
    await expect(drill).toContainText('Could sit in savings')
    await expect(drill).toContainText('credit cards owed')
    await expect(drill).toContainText('Leeway never moves money')
    await expect(drill).toContainText('rounded down')
  })
})
