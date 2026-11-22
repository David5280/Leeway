// Cash that could earn more on Plan, Bills, from a seeded household in which
// the server itself finds some: its answer adds up, the card says it
// with the rate it assumes and agrees with cash until payday above it, and
// the math opens under the same name with the rounding as its own row.

import { expect, test } from '@playwright/test'
import type { IdleCash } from '../server/src/domain/idleCash'
import { emptyIdleCashSeed, removeIdleCash, seedIdleCash } from './idleCash'
import { action } from './seed'

const NAME = 'Cash that could earn more'

/** Whole dollars, as the app writes them. */
const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`

test.describe('cash that could earn more', () => {
  const seed = emptyIdleCashSeed()
  /** The payday the seeded pay sets, which every figure below counts to. */
  let nextPayday = ''

  test.beforeAll(async ({ request }) => {
    nextPayday = (await seedIdleCash(request, seed)).nextPayday
  })
  test.afterAll(async ({ request }) => {
    await removeIdleCash(request, seed)
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
      // $412.30 owed, rounded up as every need is.
      cardsOwedCents: 41_300,
      // About $40 a day of everyday spending over the 9 days to payday and a
      // 14-day cushion, whatever the months' lengths, keeps $2,800 or so
      // back, leaving $7,000 and some dollars to round off.
      idleCents: 700_000,
      apyPercent: 4,
      // From the regular pay, not the install's own budget period.
      nextPayday,
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
