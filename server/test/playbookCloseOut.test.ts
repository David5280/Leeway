// Closing out the last pay period: which days it ran, what the flexible
// budgets allowed, what was spent and what is left. Also the debt the plan
// puts extra toward. Pure. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import type { Account } from '../src/domain/accounts.js'
import { budgetOver, closeOut, isFlexible } from '../src/domain/playbook/closeOut.js'
import { debtTarget } from '../src/domain/playbook/read.js'
import { cycleBefore, justPaid, lastPayPeriod } from '../src/domain/playbook/window.js'
import type { PeriodConfig } from '../src/lib/periods.js'
import { category } from './fixtures/playbook.js'

const TODAY = '2026-11-17'
const MONTHLY: PeriodConfig = { kind: 'monthly', startDay: 1 }

const groceries = category({})
const dining = category({ id: 'cat-dining', name: 'Dining', budgetCents: 20_000 })
const rent = category({ id: 'cat-rent', name: 'Rent', budgetCents: 150_000, trackPace: false })
const salary = category({ id: 'cat-pay', name: 'Pay', kind: 'income' })
const unbudgeted = category({ id: 'cat-misc', name: 'Misc', budgetCents: null })

describe('isFlexible', () => {
  it('counts only budgeted expenses that track pace as everyday spending', () => {
    expect([groceries, rent, salary, unbudgeted].map(isFlexible)).toEqual([
      true,
      false,
      false,
      false,
    ])
  })
})

describe('budgetOver', () => {
  it('matches the budget exactly over one budget period', () => {
    expect(budgetOver(groceries, 30, 'month')).toBe(40_000)
    expect(budgetOver(groceries, 14, 'biweek')).toBe(18_398)
  })

  it('spreads the budget by the day over any other span', () => {
    // $400 a month is $13.14 a day; 14 days is $184.
    expect(budgetOver(groceries, 14, null)).toBe(18_398)
    expect(budgetOver({ budgetCents: null, budgetCadence: 'month' }, 14, null)).toBe(0)
  })
})

describe('closeOut', () => {
  const window = { start: '2026-10-01', end: '2026-11-01' }

  it('takes the flexible budgets less their spending, the most left first', () => {
    const totals = [
      { categoryId: 'cat-groceries', amountCents: 31_000, count: 9 },
      { categoryId: 'cat-dining', amountCents: 23_500, count: 6 },
      { categoryId: 'cat-rent', amountCents: 150_000, count: 1 },
      { categoryId: null, amountCents: 4_000, count: 2 },
    ]
    const closed = closeOut([dining, rent, groceries, salary], totals, window, 'month')
    expect(closed).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-31',
      days: 31,
      budgetedCents: 60_000,
      spentCents: 54_500,
      leftoverCents: 5_500,
    })
    expect(closed.categories.map((row) => [row.name, row.leftCents])).toEqual([
      ['Groceries', 9_000],
      ['Dining', -3_500],
    ])
  })

  it('goes negative when spending ran over, and is empty with no flexible budgets', () => {
    const over = [{ categoryId: 'cat-groceries', amountCents: 52_000, count: 12 }]
    expect(closeOut([groceries], over, window, 'month').leftoverCents).toBe(-12_000)
    expect(closeOut([rent], [], window, 'month')).toMatchObject({
      budgetedCents: 0,
      spentCents: 0,
      leftoverCents: 0,
      categories: [],
    })
  })

  it('lists categories with the same amount left by name', () => {
    const closed = closeOut([groceries, category({ id: 'b', name: 'Books' })], [], window, 'month')
    expect(closed.categories.map((row) => row.name)).toEqual(['Books', 'Groceries'])
  })
})

describe('lastPayPeriod', () => {
  const biweekly = { cadence: 'biweek' as const, nextPayday: '2026-11-27' }

  it('runs from the paycheck before the latest to the day before the latest', () => {
    const paydays = ['2026-10-16', '2026-10-30', '2026-11-13']
    expect(lastPayPeriod({ ...biweekly, paydays }, TODAY, MONTHLY)).toEqual({
      window: { start: '2026-10-30', end: '2026-11-13' },
      per: null,
    })
  })

  it('steps back a cycle with only one paycheck seen, or only the owner’s own pay', () => {
    expect(lastPayPeriod({ ...biweekly, paydays: ['2026-11-13'] }, TODAY, MONTHLY).window).toEqual({
      start: '2026-10-30',
      end: '2026-11-13',
    })
    expect(lastPayPeriod({ ...biweekly, paydays: [] }, TODAY, MONTHLY).window).toEqual({
      start: '2026-10-30',
      end: '2026-11-13',
    })
  })

  it('leaves out a payday still to come', () => {
    const paydays = ['2026-10-30', '2026-11-13', '2026-11-27']
    expect(lastPayPeriod({ ...biweekly, paydays }, TODAY, MONTHLY).window.end).toBe('2026-11-13')
  })

  it('uses the previous budget period with a paycheck budget period, or no pay at all', () => {
    const paycheck: PeriodConfig = {
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-13',
      semimonthlyDays: [1, 15],
    }
    expect(lastPayPeriod({ ...biweekly, paydays: [] }, TODAY, paycheck)).toEqual({
      window: { start: '2026-10-30', end: '2026-11-13' },
      per: 'biweek',
    })
    const none = { cadence: null, paydays: [], nextPayday: null }
    expect(lastPayPeriod(none, TODAY, MONTHLY)).toEqual({
      window: { start: '2026-10-01', end: '2026-11-01' },
      per: 'month',
    })
  })

  it('uses the previous budget period when no payday can be placed', () => {
    const lost = { cadence: 'biweek' as const, paydays: [], nextPayday: null }
    expect(lastPayPeriod(lost, TODAY, MONTHLY).per).toBe('month')
  })
})

describe('cycleBefore and justPaid', () => {
  it('steps back one cycle, half a month for twice-monthly pay', () => {
    expect(cycleBefore('2026-11-15', 'semimonth')).toBe('2026-10-31')
    expect(cycleBefore('2026-11-15', 'month')).toBe('2026-10-15')
  })

  it('greets a paycheck for its first three days only', () => {
    expect(justPaid('2026-11-15', TODAY)).toBe(true)
    expect(justPaid('2026-11-14', TODAY)).toBe(false)
    expect(justPaid('2026-11-18', TODAY)).toBe(false)
    expect(justPaid(null, TODAY)).toBe(false)
  })
})

describe('debtTarget', () => {
  const account = (fields: Partial<Account>) =>
    ({
      id: 'acct',
      name: 'Card',
      type: 'credit',
      balanceCents: 50_000,
      aprPercent: null,
      hidden: false,
      unsharedAt: null,
      ...fields,
    }) as Account

  it('picks the highest rate owed, then the biggest balance', () => {
    const cards = [
      account({ id: 'low', aprPercent: 12.5, balanceCents: 300_000 }),
      account({ id: 'high', name: 'Rewards card', aprPercent: 24.99 }),
      account({ id: 'loan', type: 'loan', balanceCents: 900_000 }),
    ]
    expect(debtTarget(cards)).toEqual({
      id: 'high',
      name: 'Rewards card',
      owedCents: 50_000,
      aprBps: 2_499,
    })
    expect(debtTarget([account({ id: 'a' }), account({ id: 'b', balanceCents: 90_000 })])).toEqual({
      id: 'b',
      name: 'Card',
      owedCents: 90_000,
      aprBps: null,
    })
  })

  it('has none with nothing owed', () => {
    expect(
      debtTarget([
        account({ balanceCents: 0 }),
        account({ balanceCents: null }),
        account({ type: 'depository' }),
        account({ hidden: true }),
      ]),
    ).toBeNull()
  })
})
