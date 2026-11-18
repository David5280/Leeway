import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { carryOf, MAX_CARRIED_PERIODS, periodsBefore } from '../src/domain/rollover.js'
import { periodContaining } from '../src/lib/periods.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext & { setNow(date: Date): void }
const { call } = actionCaller(() => ctx)
const NOW = new Date('2026-11-17T18:00:00Z')

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
})

/** A charge filed under a category. */
async function spend(
  accountId: string,
  categoryId: string,
  date: string,
  cents: number,
  pending = false,
) {
  const id = await insertBankTransaction(ctx.db, accountId, {
    date,
    name: 'Bistro',
    amountCents: cents,
    pending,
  })
  await ctx.db.query('UPDATE transactions SET category_id = $2 WHERE id = $1', [id, categoryId])
}

/** Turns rollover on as if on `day`, then puts the clock back to today. */
async function rolloverFrom(categoryId: string, day: string) {
  ctx.setNow(new Date(`${day}T18:00:00Z`))
  const category = await call('update_category', { id: categoryId, rollover: true })
  ctx.setNow(NOW)
  return category
}

async function diningRow(offset = 0) {
  const budget = await call('get_budget', { offset })
  return budget.categories.find((c) => c.name === 'Dining')!
}

describe('rollover math', () => {
  const monthly = { kind: 'monthly', startDay: 1 } as const

  it('lists the whole periods from the one rollover started in, up to this one', () => {
    const november = periodContaining('2026-11-17', monthly)
    expect(periodsBefore('2026-09-20', november, monthly).map((p) => p.start)).toEqual([
      '2026-09-01',
      '2026-10-01',
    ])
    expect(periodsBefore('2026-11-02', november, monthly)).toEqual([])
    expect(periodsBefore('2000-01-01', november, monthly)).toHaveLength(MAX_CARRIED_PERIODS)
  })

  it('adds up what each period left, so savings build and overspending is paid back', () => {
    expect(carryOf(10000, [6000, 7000])).toBe(7000)
    expect(carryOf(10000, [15000])).toBe(-5000)
    expect(carryOf(10000, [])).toBe(0)
  })
})

describe('rollover budgets', () => {
  let accountId: string
  let diningId: string

  beforeEach(async () => {
    accountId = (await insertBankAccount(ctx.db)).accountId
    diningId = (await call('create_category', { name: 'Dining', budgetCents: 10000 })).id
  })

  it('is off for categories until turned on, and carries nothing then', async () => {
    await spend(accountId, diningId, '2026-10-10', 2000)
    expect(await diningRow()).toMatchObject({
      rollover: false,
      carriedCents: null,
      budgetCents: 10000,
    })
  })

  it('carries what last period left unspent into this one', async () => {
    const category = await rolloverFrom(diningId, '2026-10-05')
    expect(category).toMatchObject({ rollover: true, rolloverSince: '2026-10-05' })
    await spend(accountId, diningId, '2026-10-10', 6000)
    await spend(accountId, diningId, '2026-11-03', 3000)
    expect(await diningRow()).toMatchObject({
      rollover: true,
      carriedCents: 4000,
      budgetCents: 14000,
      leftCents: 11000,
    })
    const budget = await call('get_budget', { offset: 0 })
    expect(budget.totals).toMatchObject({ budgetedCents: 14000, leftCents: 11000 })
  })

  it('carries an overspend as less to spend, and over budget once it is used up', async () => {
    await rolloverFrom(diningId, '2026-10-05')
    await spend(accountId, diningId, '2026-10-10', 15000)
    expect(await diningRow()).toMatchObject({ carriedCents: -5000, budgetCents: 5000 })

    await spend(accountId, diningId, '2026-10-20', 7000)
    // October went $120 over the $100: November starts $120 short.
    expect(await diningRow()).toMatchObject({
      carriedCents: -12000,
      budgetCents: -2000,
      percentUsed: 100,
      status: 'over',
    })
  })

  it('builds up over several periods, and shows an earlier period with its own carry', async () => {
    await rolloverFrom(diningId, '2026-09-15')
    await spend(accountId, diningId, '2026-09-10', 2000)
    await spend(accountId, diningId, '2026-10-10', 13000)
    // September left $80; October overspent by $30.
    expect((await diningRow()).carriedCents).toBe(5000)
    expect(await diningRow(-1)).toMatchObject({ carriedCents: 8000, budgetCents: 18000 })
    expect((await diningRow(-2)).carriedCents).toBe(0)
  })

  it('keeps when it started while it stays on, and starts fresh when turned on again', async () => {
    await rolloverFrom(diningId, '2026-09-15')
    expect((await rolloverFrom(diningId, '2026-10-15')).rolloverSince).toBe('2026-09-15')
    const off = await call('update_category', { id: diningId, rollover: false })
    expect(off).toMatchObject({ rollover: false, rolloverSince: null })
    expect((await call('update_category', { id: diningId, rollover: true })).rolloverSince).toBe(
      '2026-11-17',
    )
    // Turned on this period, nothing has carried in yet.
    expect((await diningRow()).carriedCents).toBe(0)
    // Other changes leave rollover as it is.
    expect(await call('update_category', { id: diningId, name: 'Dining' })).toMatchObject({
      rollover: true,
      rolloverSince: '2026-11-17',
    })
  })

  it('carries each category from its own start', async () => {
    const fun = await call('create_category', { name: 'Fun', budgetCents: 5000 })
    await rolloverFrom(diningId, '2026-11-01')
    await rolloverFrom(fun.id, '2026-09-01')
    await spend(accountId, diningId, '2026-10-10', 9000)
    await spend(accountId, fun.id, '2026-10-10', 1000)
    const budget = await call('get_budget', { offset: 0 })
    expect(budget.categories.map((c) => [c.name, c.carriedCents])).toEqual([
      ['Dining', 0],
      ['Fun', 9000],
    ])
  })

  it('counts spending the way budgets do: pending as set, hidden accounts never', async () => {
    await rolloverFrom(diningId, '2026-10-01')
    await spend(accountId, diningId, '2026-10-10', 3000, true)
    const hidden = await insertBankAccount(ctx.db, { hidden: true })
    await spend(hidden.accountId, diningId, '2026-10-11', 5000)
    expect((await diningRow()).carriedCents).toBe(7000)
    await call('update_settings', { includePending: false })
    expect((await diningRow()).carriedCents).toBe(10000)
  })

  it('converts the budget to the period, and ignores rollover without a budget', async () => {
    await call('update_category', { id: diningId, budgetCents: 2500, budgetCadence: 'week' })
    await rolloverFrom(diningId, '2026-10-01')
    // $25 a week is about $108.71 a month.
    expect((await diningRow()).carriedCents).toBe(10871)
    await call('update_category', { id: diningId, budgetCents: null })
    expect(await diningRow()).toMatchObject({ rollover: true, carriedCents: null })
  })

  it('keeps rollover out of an exported setup', async () => {
    await rolloverFrom(diningId, '2026-10-01')
    const exported = await call('export_config')
    expect(exported.categories[0]).not.toHaveProperty('rollover')
    expect(exported.categories[0]).not.toHaveProperty('rolloverSince')
  })
})

describe('goals set aside from the budget', () => {
  it('holds their share back from what is safe to spend, this period only', async () => {
    await call('create_category', { name: 'Groceries', budgetCents: 60000 })
    const bike = await call('create_goal', {
      kind: 'purchase',
      name: 'Road bike',
      targetCents: 180000,
      targetDate: '2027-04-30',
      setAside: true,
      color: '#5ccf8c',
    })
    await call('create_goal', { name: 'Not held', targetCents: 50000, targetDate: '2027-01-31' })

    const budget = await call('get_budget', { offset: 0 })
    expect(budget.setAsides).toEqual([
      { goalId: bike.id, name: 'Road bike', color: '#5ccf8c', amountCents: 30000 },
    ])
    // $600 left, $300 held for the bike: $300 over 14 days, today included.
    expect(budget.totals).toMatchObject({
      leftCents: 60000,
      setAsideCents: 30000,
      leewayCents: 30000,
      safePerDayCents: 2142,
    })

    const october = await call('get_budget', { offset: -1 })
    expect(october.setAsides).toEqual([])
    expect(october.totals.leewayCents).toBe(october.totals.leftCents)

    const checkin = await call('get_checkin')
    expect(checkin.budget).toMatchObject({ setAsideCents: 30000, leewayCents: 30000 })
  })
})
