// Safe to spend until payday (cashFlow.ts) and the budget's room held to it
// (spendable.ts): available cash in checking, less bills before payday and any
// overdraft, never below zero, with the shortfall apart.

import { describe, expect, it } from 'vitest'
import type { BudgetSummary } from '../src/domain/budget.js'
import { checkingCash, safeToSpend, type BillDue } from '../src/domain/cashFlow.js'
import type { Payday } from '../src/domain/pay/payday.js'
import { spendable, untilWords } from '../src/domain/spendable.js'
import { formatCents } from '../src/lib/money.js'

const TODAY = '2026-11-17'
const money = (cents: number) => formatCents(cents)

const payday = (fields: Partial<Payday> = {}): Payday => ({
  date: '2026-11-30',
  source: 'detected_income',
  amountCents: 210_000,
  cadence: 'semimonth',
  estimate: false,
  ...fields,
})

const bill = (name: string, dueDate: string, amountCents: number): BillDue => ({
  billId: name,
  name,
  dueDate,
  amountCents,
  overdue: dueDate < TODAY,
})

/** Checking with $178 available of a $250 balance: pending charges already out. */
const everyday = { availableCents: 17_800, balanceCents: 25_000 }

/** A budget period with this much room left after goals, 13 days to go counting today. */
function budget(leewayCents: number, safePerDayCents = Math.floor(leewayCents / 13)) {
  return {
    period: { offset: 0, daysLeft: 12 },
    totals: { budgetedCents: leewayCents ? 300_000 : 0, leewayCents, safePerDayCents },
  } as BudgetSummary
}

describe('checkingCash', () => {
  it('takes the available balance first, and owes back what an overdrawn account is below zero', () => {
    expect(checkingCash(everyday)).toEqual({ cashCents: 17_800, overdraftCents: 0 })
    expect(checkingCash({ availableCents: null, balanceCents: 40_000 })).toEqual({
      cashCents: 40_000,
      overdraftCents: 0,
    })
    // Overdrawn: nothing to spend, and the lower balance is what it needs back.
    expect(checkingCash({ availableCents: 0, balanceCents: -14_210 })).toEqual({
      cashCents: 0,
      overdraftCents: 14_210,
    })
    expect(checkingCash({ availableCents: -3_000, balanceCents: 1_000 })).toEqual({
      cashCents: 0,
      overdraftCents: 3_000,
    })
  })
})

describe('safeToSpend', () => {
  it('is the cash in checking until payday, a day at a time counting today', () => {
    const flow = safeToSpend([everyday], [], payday(), TODAY)
    expect(flow).toMatchObject({
      cashKnown: true,
      cashCents: 17_800,
      safeCents: 17_800,
      shortfallCents: 0,
      daysUntilPayday: 13,
      perDayCents: 1_369,
    })
  })

  it('takes out bills before payday, and says how far they outrun the cash', () => {
    const fits = safeToSpend([everyday], [bill('Phone', '2026-11-20', 6_000)], payday(), TODAY)
    expect(fits).toMatchObject({ billsDueCents: 6_000, safeCents: 11_800, shortfallCents: 0 })
    const short = safeToSpend(
      [everyday],
      [bill('Phone', '2026-11-20', 6_000), bill('Power', '2026-11-25', 14_000)],
      payday(),
      TODAY,
    )
    expect(short).toMatchObject({ safeCents: 0, shortfallCents: 2_200, perDayCents: 0 })
  })

  it('takes out what an overdrawn account needs to get back to zero', () => {
    const overdrawn = { availableCents: 0, balanceCents: -14_210 }
    expect(safeToSpend([everyday, overdrawn], [], payday(), TODAY)).toMatchObject({
      cashCents: 17_800,
      overdraftCents: 14_210,
      safeCents: 3_590,
      shortfallCents: 0,
    })
    expect(safeToSpend([overdrawn], [], payday(), TODAY)).toMatchObject({
      safeCents: 0,
      shortfallCents: 14_210,
    })
  })

  it('knows no cash without a checking balance, rather than calling it zero', () => {
    const flow = safeToSpend(
      [{ availableCents: null, balanceCents: null }],
      [bill('Rent', '2026-11-20', 150_000)],
      payday(),
      TODAY,
    )
    expect(flow).toMatchObject({ cashKnown: false, safeCents: 0, shortfallCents: 0 })
  })
})

describe('spendable', () => {
  const room = (leewayCents: number, flow = safeToSpend([everyday], [], payday(), TODAY)) =>
    spendable(budget(leewayCents), flow, money, 'en-US')

  it('leads with the cash when it is less than the budget has left, and says why in one line', () => {
    expect(room(140_400)).toMatchObject({
      budgetLeftCents: 140_400,
      safeCents: 17_800,
      leadCents: 17_800,
      limitedBy: 'cash',
      perDayCents: 1_369,
      note: 'Your budget has $1,404 left, but you have $178 you can safely spend before payday on Nov 30.',
      problem: false,
    })
  })

  it('leads with the budget when checking can cover it, with no note', () => {
    expect(room(10_000)).toMatchObject({
      leadCents: 10_000,
      limitedBy: 'budget',
      perDayCents: 769,
      note: null,
      problem: false,
    })
  })

  it('is red only for an overdraft or a shortfall', () => {
    const overdrawn = safeToSpend(
      [everyday, { availableCents: 0, balanceCents: -5_000 }],
      [],
      payday(),
      TODAY,
    )
    expect(room(140_400, overdrawn)).toMatchObject({ safeCents: 12_800, problem: true })
    const short = safeToSpend([everyday], [bill('Rent', '2026-11-20', 30_000)], payday(), TODAY)
    expect(room(140_400, short)).toMatchObject({
      leadCents: 0,
      problem: true,
      note: 'Checking is $122 short of the bills before payday on Nov 30.',
    })
  })

  it('says when payday is a guess, or not found, so the end of the period stands in', () => {
    const estimate = safeToSpend([everyday], [], payday({ estimate: true }), TODAY)
    expect(room(140_400, estimate).note).toBe(
      'Your budget has $1,404 left, but you have $178 you can safely spend before payday, about Nov 30.',
    )
    const periodEnd = safeToSpend(
      [everyday],
      [],
      payday({ date: '2026-12-01', source: 'period_end', amountCents: null, cadence: null }),
      TODAY,
    )
    expect(room(140_400, periodEnd).note).toBe(
      'Your budget has $1,404 left, but you have $178 you can safely spend by Nov 30, when this budget period ends (no payday found yet).',
    )
    expect(
      untilWords(
        { payday: '2026-11-30', paydaySource: 'pay_period', paydayEstimate: false },
        'en-US',
      ),
    ).toBe('before payday on Nov 30')
  })

  it('goes by the budget alone while no checking balance is known', () => {
    const unknown = safeToSpend([], [], payday(), TODAY)
    expect(room(140_400, unknown)).toMatchObject({
      leadCents: 140_400,
      limitedBy: 'budget',
      perDayCents: 10_800,
      note: null,
      problem: false,
    })
  })
})
