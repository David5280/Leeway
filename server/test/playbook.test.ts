// The payday playbook through its action: the last pay period closed out
// from real spending, the next paycheck planned, a paycheck that just landed
// greeted, and nothing planned while no pay is known. Every name and amount
// is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import { everyDays, insertPaychecks } from './fixtures/pay.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC.
let ctx: AppContext
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const checking = () =>
  insertBankAccount(ctx.db, { subtype: 'checking', mask: '9876', balanceCents: 300_000 }).then(
    (a) => a.accountId,
  )

/** Groceries budgeted at $400 a month, with one $120 shop on the day given. */
async function groceriesSpentOn(accountId: string, date: string): Promise<void> {
  const groceries = await call('create_category', { name: 'Groceries', budgetCents: 40_000 })
  const shop = await insertBankTransaction(ctx.db, accountId, {
    date,
    name: 'CORNER GROCER',
    amountCents: 12_000,
  })
  await ctx.db.query('UPDATE transactions SET category_id = $2 WHERE id = $1', [shop, groceries.id])
}

describe('get_payday_playbook', () => {
  it('closes out the last pay period and plans the next paycheck', async () => {
    const accountId = await checking()
    // Every two weeks, the newest on Fri, Nov 13, so the next is Nov 27.
    await insertPaychecks(ctx.db, accountId, everyDays('2026-09-04', 14, 6), 210_000)
    await groceriesSpentOn(accountId, '2026-11-05')
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-11-25',
    })
    const playbook = await call('get_payday_playbook')
    expect(playbook.justPaid).toBe(false)
    expect(playbook.paycheck).toEqual({ amountCents: 210_000, date: '2026-11-27', landed: false })
    // Oct 30 to Nov 12: $400 a month over 14 days is $183.98, less the $120 shop.
    expect(playbook.closeOut).toMatchObject({
      start: '2026-10-30',
      end: '2026-11-12',
      budgetedCents: 18_398,
      spentCents: 12_000,
      leftoverCents: 6_398,
    })
    const plan = playbook.plan!
    expect(plan.toPlanCents).toBe(216_398)
    expect(plan.steps.map((step) => step.key)).toEqual(['bills', 'spending', 'savings'])
    expect(plan.steps[0]).toMatchObject({ amountCents: 150_000 })
    expect(plan.steps[0]!.items[0]).toMatchObject({ label: 'Rent', date: '2026-11-25' })
    expect(plan.shortCents).toBe(0)
    expect(playbook.overdraft.accounts).toHaveLength(1)
    expect(JSON.stringify(playbook)).not.toContain('9876')
  })

  it('greets a paycheck that just landed and plans that one', async () => {
    const accountId = await checking()
    // The newest landed Mon, Nov 16.
    await insertPaychecks(ctx.db, accountId, everyDays('2026-09-07', 14, 6), 205_000)
    const playbook = await call('get_payday_playbook')
    expect(playbook.justPaid).toBe(true)
    expect(playbook.paycheck).toEqual({ amountCents: 205_000, date: '2026-11-16', landed: true })
    expect(playbook.closeOut).toMatchObject({ start: '2026-11-02', end: '2026-11-15' })
  })

  it('plans everyday spending from what is usually spent when nothing is budgeted', async () => {
    const accountId = await checking()
    await insertPaychecks(ctx.db, accountId, everyDays('2026-07-10', 14, 10), 210_000)
    for (const month of ['2026-08', '2026-09', '2026-10']) {
      await insertBankTransaction(ctx.db, accountId, {
        date: `${month}-14`,
        name: 'CORNER GROCER',
        amountCents: 60_000,
      })
    }
    await call('create_bill', {
      name: 'Phone',
      amountCents: 6_000,
      cadence: 'month',
      anchorDate: '2026-12-05',
    })
    const { plan } = await call('get_payday_playbook')
    // About $600 a month less the $60 phone, a paycheck's worth.
    expect(plan!.steps.find((step) => step.key === 'spending')!.items).toEqual([
      expect.objectContaining({ label: 'Everyday spending', note: 'usual' }),
    ])
  })

  it('leaves everyday spending out of the plan with the owner’s own pay and no history', async () => {
    await call('set_pay', {
      pay: { amountCents: 250_000, cadence: 'semimonth', nextPayday: '2026-12-01' },
    })
    const playbook = await call('get_payday_playbook')
    expect(playbook.paycheck).toEqual({ amountCents: 250_000, date: '2026-12-01', landed: false })
    expect(playbook.plan!.steps.map((step) => step.key)).toEqual(['savings'])
  })

  it('plans nothing while no pay is known, closing out the last budget period', async () => {
    const accountId = await checking()
    await groceriesSpentOn(accountId, '2026-10-12')
    const playbook = await call('get_payday_playbook')
    expect(playbook.paycheck).toBeNull()
    expect(playbook.plan).toBeNull()
    expect(playbook.closeOut).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-31',
      budgetedCents: 40_000,
      leftoverCents: 28_000,
    })
  })
})
