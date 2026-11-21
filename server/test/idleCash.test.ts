// Idle cash (idleCash.ts, idleCashSource.ts): money in checking well past
// what it needs before payday, said with the assumed savings rate, and never
// while an account is overdrawn or safe to spend is tight.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ASSUMED_SAVINGS_APY_PERCENT,
  checkIdleCash,
  CUSHION_FLOOR_CENTS,
  IDLE_FLOOR_CENTS,
  yearlyInterest,
  type IdleCashInputs,
} from '../src/domain/idleCash.js'
import { anyOverdrawn, dailySpend } from '../src/domain/idleCashSource.js'
import type { Account } from '../src/domain/accounts.js'
import type { MonthTotals } from '../src/domain/monthlyTotals.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

/** $8,000 in checking, $1,200 of bills, $50 a day for 10 days: plenty spare. */
const flush = (fields: Partial<IdleCashInputs> = {}): IdleCashInputs => ({
  checkingCents: 800_000,
  billsCents: 120_000,
  dailySpendCents: 5_000,
  daysUntilPayday: 10,
  nextPayday: '2026-11-27',
  overdrawn: false,
  tight: false,
  ...fields,
})

describe('checkIdleCash', () => {
  it('suggests what is left past bills, spending and a cushion, rounded down', () => {
    const idle = checkIdleCash(flush())
    // Needed: $1,200 bills + $500 spending + $700 cushion (14 days at $50).
    expect(idle).toMatchObject({
      suggested: true,
      reason: null,
      billsCents: 120_000,
      spendingCents: 50_000,
      cushionCents: 70_000,
      neededCents: 240_000,
      idleCents: 560_000,
      apyPercent: ASSUMED_SAVINGS_APY_PERCENT,
      nextPayday: '2026-11-27',
    })
    // $5,600 at 4% is $224 a year.
    expect(idle.yearlyInterestCents).toBe(22_400)
  })

  it('keeps at least the cushion floor when spending is light', () => {
    const idle = checkIdleCash(flush({ dailySpendCents: 1_000 }))
    expect(idle.cushionCents).toBe(CUSHION_FLOOR_CENTS)
  })

  it('counts a day of spending when payday is today or tomorrow', () => {
    expect(checkIdleCash(flush({ daysUntilPayday: 0 })).spendingCents).toBe(5_000)
  })

  it('rounds the spare cash down to a round hundred', () => {
    expect(checkIdleCash(flush({ checkingCents: 805_999 })).idleCents).toBe(560_000)
  })

  it(`says nothing for less than the ${IDLE_FLOOR_CENTS / 100} worth moving`, () => {
    const idle = checkIdleCash(flush({ checkingCents: 240_000 + IDLE_FLOOR_CENTS - 1 }))
    expect(idle).toMatchObject({ suggested: false, reason: 'not_enough_extra', idleCents: 0 })
    expect(idle.yearlyInterestCents).toBe(0)
    expect(checkIdleCash(flush({ checkingCents: 240_000 + IDLE_FLOOR_CENTS })).suggested).toBe(true)
  })

  it('never suggests while an account is overdrawn or safe to spend is tight', () => {
    expect(checkIdleCash(flush({ overdrawn: true }))).toMatchObject({
      suggested: false,
      reason: 'overdrawn',
      idleCents: 0,
    })
    expect(checkIdleCash(flush({ tight: true }))).toMatchObject({
      suggested: false,
      reason: 'tight',
    })
  })

  it('never guesses without a month of spending to go by', () => {
    expect(checkIdleCash(flush({ dailySpendCents: null })).reason).toBe('no_spending_history')
  })
})

describe('yearlyInterest', () => {
  it('works at the assumed rate unless told another', () => {
    expect(yearlyInterest(100_000)).toBe(4_000)
    expect(yearlyInterest(100_000, 5)).toBe(5_000)
  })
})

const month = (start: string, spentCents: number, current = false): MonthTotals => ({
  start,
  end: start,
  current,
  spentCents,
  incomeCents: 0,
  unfiledInCents: 0,
  categories: [],
})

describe('dailySpend', () => {
  it('averages the finished months over their days, leaving the running month out', () => {
    // $3,100 in October (31 days) and $3,000 in September (30 days): $100 a day.
    const months = [
      month('2026-09-01', 300_000),
      month('2026-10-01', 310_000),
      month('2026-11-01', 999_999, true),
    ]
    expect(dailySpend(months)).toBe(10_000)
  })

  it('is unknown with no finished month', () => {
    expect(dailySpend([month('2026-11-01', 5_000, true)])).toBeNull()
  })
})

describe('anyOverdrawn', () => {
  const account = (fields: Partial<Account>) =>
    ({
      type: 'depository',
      balanceCents: 10_000,
      availableCents: null,
      unsharedAt: null,
      ...fields,
    }) as Account

  it('reads either balance below zero on a bank account still shared', () => {
    expect(anyOverdrawn([account({})])).toBe(false)
    expect(anyOverdrawn([account({ balanceCents: -1 })])).toBe(true)
    expect(anyOverdrawn([account({ availableCents: -500 })])).toBe(true)
    // A card's balance is what is owed, never an overdraft; an old balance is not current.
    expect(anyOverdrawn([account({ type: 'credit', balanceCents: -100 })])).toBe(false)
    expect(anyOverdrawn([account({ balanceCents: -1, unsharedAt: '2026-11-01' })])).toBe(false)
  })
})

describe('get_idle_cash', () => {
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

  /** Checking holding `balance`, with $1,500 spent in each of the last three months. */
  async function checking(balanceCents: number) {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents })
    for (const date of ['2026-08-10', '2026-09-10', '2026-10-10']) {
      await insertBankTransaction(ctx.db, accountId, { date, name: 'GROCER', amountCents: 150_000 })
    }
    return accountId
  }

  it('suggests the spare cash, with the rate it assumes', async () => {
    await checking(1_500_000)
    const idle = await call('get_idle_cash')
    expect(idle).toMatchObject({ suggested: true, reason: null, apyPercent: 4 })
    expect(idle.idleCents).toBeGreaterThan(0)
    expect(idle.idleCents % 10_000).toBe(0)
    expect(idle.yearlyInterestCents).toBe(yearlyInterest(idle.idleCents))
    expect(idle.checkingCents).toBe(1_500_000)
  })

  it('says nothing while another account is overdrawn', async () => {
    await checking(1_500_000)
    await insertBankAccount(ctx.db, { subtype: 'savings', balanceCents: -2_000 })
    expect(await call('get_idle_cash')).toMatchObject({ suggested: false, reason: 'overdrawn' })
  })

  it('says nothing when the bills before payday outrun the cash', async () => {
    await checking(50_000)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 200_000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })
    expect(await call('get_idle_cash')).toMatchObject({ suggested: false, reason: 'tight' })
  })

  it('says nothing when the budgets are already spent past what they allow', async () => {
    const accountId = await checking(1_500_000)
    const groceries = await call('create_category', {
      name: 'Groceries',
      kind: 'expense',
      budgetCents: 10_000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-05',
      name: 'GROCER',
      amountCents: 50_000,
    })
    await ctx.db.query(`UPDATE transactions SET category_id = $1 WHERE date = '2026-11-05'`, [
      groceries.id,
    ])
    expect(await call('get_idle_cash')).toMatchObject({ suggested: false, reason: 'tight' })
  })
})
