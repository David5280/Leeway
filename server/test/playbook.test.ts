// The payday playbook through its action: the last pay period closed out
// from real spending, the leftover's suggestions, the new paycheck's plan on
// the same figures as safe to spend, and nothing to close out while no pay
// is known. Every name and amount is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSettings, periodConfig } from '../src/domain/settings.js'
import { cadenceOf, convertCadence } from '../src/lib/periods.js'
import { actionCaller } from './actionCaller.js'
import { BIWEEKLY, insertPaychecks } from './fixtures/pay.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads Tue, Nov 17, 2026. Pay comes every other Friday, the
// newest on Nov 13, so the period that just closed ran Oct 30 to Nov 12.
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
})

/** $400 a month of groceries is this much a paycheck. */
const GROCERIES_A_PAYCHECK = convertCadence(40_000, 'month', 'biweek')

/** A checking account holding $3,000, paid $2,100 every two weeks; its id. */
async function paidChecking(): Promise<string> {
  const { accountId } = await insertBankAccount(ctx.db, {
    subtype: 'checking',
    mask: '9876',
    balanceCents: 300_000,
  })
  await insertPaychecks(ctx.db, accountId, BIWEEKLY, 210_000)
  return accountId
}

/** Files a new purchase or transfer on the day given into a category. */
async function spend(accountId: string, categoryId: string, date: string, cents: number) {
  const id = await insertBankTransaction(ctx.db, accountId, {
    date,
    name: 'ACME STORE',
    amountCents: cents,
  })
  await ctx.db.query('UPDATE transactions SET category_id = $2 WHERE id = $1', [id, categoryId])
}

const groceries = () => call('create_category', { name: 'Groceries', budgetCents: 40_000 })

describe('get_payday_playbook', () => {
  it('closes out the last pay period from what was spent in it', async () => {
    const accountId = await paidChecking()
    const { id } = await groceries()
    await spend(accountId, id, '2026-10-29', 3_000) // the period before
    await spend(accountId, id, '2026-11-05', 12_000) // in the period
    await spend(accountId, id, '2026-11-14', 5_000) // the new period
    const playbook = await call('get_payday_playbook')
    expect(playbook).toMatchObject({
      lastPayday: '2026-11-13',
      justPaid: false,
      nextPayday: '2026-11-27',
      paydaySource: 'detected_income',
    })
    expect(playbook.closeOut).toMatchObject({
      start: '2026-10-30',
      end: '2026-11-12',
      budgetedCents: GROCERIES_A_PAYCHECK,
      spentCents: 12_000,
      leftoverCents: GROCERIES_A_PAYCHECK - 12_000,
    })
  })

  it('greets a paycheck that just landed', async () => {
    await paidChecking()
    ctx.setNow(new Date('2026-11-14T18:00:00Z'))
    const playbook = await call('get_payday_playbook')
    expect(playbook).toMatchObject({ lastPayday: '2026-11-13', justPaid: true })
  })

  it('never counts a transfer between own accounts as spending', async () => {
    const accountId = await paidChecking()
    await groceries()
    const transfer = await call('create_category', { name: 'Own transfers', kind: 'transfer' })
    await spend(accountId, transfer.id, '2026-11-06', 50_000)
    const playbook = await call('get_payday_playbook')
    expect(playbook.closeOut?.spentCents).toBe(0)
  })

  it('suggests where the leftover could go', async () => {
    await paidChecking()
    await groceries()
    await call('create_goal', {
      name: 'Spring trip',
      targetCents: 100_000,
      targetDate: '2027-04-01',
    })
    const playbook = await call('get_payday_playbook')
    expect(playbook.suggestions).toContainEqual(
      expect.objectContaining({ kind: 'goal', label: 'Spring trip' }),
    )
    const total = playbook.suggestions.reduce((sum, one) => sum + one.amountCents, 0)
    expect(total).toBeLessThanOrEqual(GROCERIES_A_PAYCHECK)
  })

  it('suggests nothing after an overspent period', async () => {
    const accountId = await paidChecking()
    const { id } = await groceries()
    await spend(accountId, id, '2026-11-05', 25_000)
    await call('create_goal', {
      name: 'Spring trip',
      targetCents: 100_000,
      targetDate: '2027-04-01',
    })
    const playbook = await call('get_payday_playbook')
    expect(playbook.closeOut?.leftoverCents).toBe(GROCERIES_A_PAYCHECK - 25_000)
    expect(playbook.suggestions).toEqual([])
  })

  it('quotes what can be spent now as get_cash_flow leads with it, set-asides held back', async () => {
    await paidChecking()
    await groceries()
    await call('add_sinking_fund', {
      name: 'Car insurance',
      amountCents: 60_000,
      cadence: 'year',
      dueDate: '2027-06-01',
    })
    const { plan } = await call('get_payday_playbook')
    const { safeCents, spendable } = await call('get_cash_flow')
    // The budget's room after the set-aside is less than the $3,000 in checking.
    expect(spendable!.limitedBy).toBe('budget')
    expect(plan.safeToSpendCents).toBe(spendable!.leadCents)
    expect(plan.safeToSpendCents).toBeLessThan(safeCents)
  })

  it('plans the new paycheck on the same figures as safe to spend', async () => {
    await paidChecking()
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-11-25',
    })
    await call('add_sinking_fund', {
      name: 'Car insurance',
      amountCents: 60_000,
      cadence: 'year',
      dueDate: '2027-06-01',
    })
    const { plan } = await call('get_payday_playbook')
    const flow = await call('get_cash_flow')
    const { funds } = await call('list_sinking_funds')
    const period = cadenceOf(periodConfig(await getSettings(ctx.db)))
    expect(plan.paycheckCents).toBe(210_000)
    expect(plan.safeToSpendCents).toBe(flow.spendable!.leadCents)
    expect(plan.lines).toEqual([
      {
        kind: 'bill',
        name: 'Rent',
        amountCents: 150_000,
        dueDate: '2026-11-25',
        paid: false,
        overdue: false,
      },
      {
        kind: 'sinking_fund',
        name: 'Car insurance',
        amountCents: convertCadence(funds[0]!.perPeriodCents, period, 'biweek'),
        dueDate: null,
        paid: false,
        overdue: false,
      },
    ])
    expect(plan.everydayCents).toBe(210_000 - plan.billsCents - plan.setAsideCents)
  })

  it('counts a bill already paid this pay period, so the figure holds still once rent clears', async () => {
    const accountId = await paidChecking()
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-10-25',
      matchPattern: 'LANDLORD',
    })
    const before = (await call('get_payday_playbook')).plan
    // Nov 26: rent cleared the day after it was due.
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-26',
      name: 'LANDLORD RENT',
      amountCents: 150_000,
    })
    ctx.setNow(new Date('2026-11-26T18:00:00Z'))
    const after = (await call('get_payday_playbook')).plan
    const flow = await call('get_cash_flow')
    expect(after.lines[0]).toMatchObject({ name: 'Rent', dueDate: '2026-11-25', paid: true })
    expect(after.everydayCents).toBe(before.everydayCents)
    expect(after.everydayCents).toBe(210_000 - 150_000 - after.setAsideCents)
    // The cash line no longer waits on it.
    expect(flow.billsDue.map((bill) => bill.name)).not.toContain('Rent')
  })

  it('shows no account number anywhere', async () => {
    await paidChecking()
    await groceries()
    const playbook = await call('get_payday_playbook')
    expect(JSON.stringify(playbook)).not.toContain('9876')
  })

  it('has nothing to close out while no pay is known', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking' })
    await groceries()
    const playbook = await call('get_payday_playbook')
    expect(playbook).toMatchObject({
      lastPayday: null,
      justPaid: false,
      closeOut: null,
      suggestions: [],
      paydaySource: 'period_end',
    })
    expect(playbook.plan.paycheckCents).toBeNull()
    expect(playbook.plan.everydayCents).toBeNull()
  })
})
