// The new paycheck's plan: every bill due in the pay period, paid or not,
// and the set-asides safe to spend already holds back, laid side by side and
// never counted twice. What it leaves holds still all period. Every name and
// amount is made up.

import { describe, expect, it } from 'vitest'
import { periodBills, planPaycheck, type PlanFacts } from '../src/domain/playbook/plan.js'
import { billOf } from './fixtures/playbook.js'

/** Paid on Nov 13; the next payday is Nov 27; read on Nov 17. */
const FACTS: PlanFacts = {
  paycheckCents: 210_000,
  periodStart: '2026-11-13',
  nextPayday: '2026-11-27',
  today: '2026-11-17',
  bills: [
    billOf(),
    // Paid on the 15th, its due day.
    billOf({
      id: 'bill-phone',
      name: 'Phone',
      amountCents: 6_000,
      anchorDate: '2026-10-15',
      matchPattern: 'PHONECO',
      lastPaidDate: '2026-11-15',
      lastPaidCents: 6_000,
    }),
  ],
  setAsides: [
    { goalId: 'goal-trip', name: 'Spring trip', color: '#4f8cff', amountCents: 10_000 },
    {
      goalId: 'fund-car',
      name: 'Car insurance',
      color: '#2BB3A3',
      amountCents: 5_000,
      kind: 'sinking_fund',
    },
  ],
  periodCadence: 'biweek',
  payCadence: 'biweek',
  safeToSpendCents: 80_000,
}

describe('planPaycheck', () => {
  it("lists the pay period's bills, paid or not, then the set-asides and sinking funds", () => {
    const plan = planPaycheck(FACTS)
    expect(plan.lines.map((line) => [line.kind, line.name, line.amountCents])).toEqual([
      ['bill', 'Phone', 6_000],
      ['bill', 'Rent', 150_000],
      ['set_aside', 'Spring trip', 10_000],
      ['sinking_fund', 'Car insurance', 5_000],
    ])
    expect(plan.lines[0]).toMatchObject({ dueDate: '2026-11-15', paid: true, overdue: false })
    expect(plan.lines[1]).toMatchObject({ dueDate: '2026-11-25', paid: false, overdue: false })
    expect(plan.lines[2]).toMatchObject({ dueDate: null, paid: false, overdue: false })
  })

  it('leaves the paycheck less the bills and set-asides for everyday spending', () => {
    const plan = planPaycheck(FACTS)
    expect(plan).toMatchObject({
      paycheckCents: 210_000,
      periodStart: '2026-11-13',
      billsCents: 156_000,
      setAsideCents: 15_000,
      everydayCents: 39_000,
    })
  })

  it('holds still when rent clears mid-period', () => {
    const before = planPaycheck(FACTS)
    // Nov 26: rent paid the day after it was due.
    const paidRent = billOf(
      { matchPattern: 'LANDLORD', lastPaidDate: '2026-11-26', lastPaidCents: 150_000 },
      '2026-11-26',
    )
    const after = planPaycheck({
      ...FACTS,
      today: '2026-11-26',
      bills: [paidRent, FACTS.bills[1]!],
    })
    expect(after.lines.find((line) => line.name === 'Rent')).toMatchObject({ paid: true })
    expect(after.everydayCents).toBe(before.everydayCents)
    expect(after.billsCents).toBe(before.billsCents)
  })

  it('quotes safe to spend as it is, without taking the set-asides out again', () => {
    expect(planPaycheck(FACTS).safeToSpendCents).toBe(80_000)
  })

  it('goes negative when the bills and set-asides outrun the paycheck', () => {
    expect(planPaycheck({ ...FACTS, paycheckCents: 100_000 }).everydayCents).toBe(-71_000)
  })

  it('has nothing left to say with no paycheck known', () => {
    const plan = planPaycheck({ ...FACTS, paycheckCents: null })
    expect(plan.everydayCents).toBeNull()
    expect(plan.billsCents).toBe(156_000)
  })

  it('spreads a monthly set-aside to each paycheck when budgets run by the month', () => {
    const plan = planPaycheck({
      ...FACTS,
      bills: [],
      periodCadence: 'month',
      payCadence: 'semimonth',
    })
    expect(plan.lines.map((line) => line.amountCents)).toEqual([5_000, 2_500])
  })

  it('leaves out a set-aside that holds nothing back', () => {
    const empty = { goalId: 'goal-x', name: 'Done', color: '#000000', amountCents: 0 }
    const plan = planPaycheck({ ...FACTS, setAsides: [empty] })
    expect(plan.lines.every((line) => line.kind === 'bill')).toBe(true)
  })
})

describe('periodBills', () => {
  const { periodStart, nextPayday, today } = FACTS
  const dates = (bills: Parameters<typeof periodBills>[0]) =>
    periodBills(bills, periodStart, nextPayday, today).map((line) => line.dueDate)

  it('leaves a bill due on payday to the paycheck that lands that day', () => {
    expect(dates([billOf({ anchorDate: '2026-10-27' })])).toEqual([])
    expect(dates([billOf({ anchorDate: '2026-10-13' })])).toEqual(['2026-11-13'])
  })

  it('counts every due date of a weekly bill, but none before its first', () => {
    expect(dates([billOf({ cadence: 'week', anchorDate: '2026-11-06' })])).toEqual([
      '2026-11-13',
      '2026-11-20',
    ])
    expect(dates([billOf({ cadence: 'week', anchorDate: '2026-11-20' })])).toEqual(['2026-11-20'])
  })

  it('marks a due date passed with no payment found as overdue', () => {
    const internet = billOf({ anchorDate: '2026-10-14', matchPattern: 'NETCO' })
    expect(periodBills([internet], periodStart, nextPayday, today)).toEqual([
      expect.objectContaining({ dueDate: '2026-11-14', paid: false, overdue: true }),
    ])
  })

  it('marks a passed due date paid only when its payment was seen', () => {
    const seen = billOf({
      anchorDate: '2026-10-14',
      matchPattern: 'NETCO',
      lastPaidDate: '2026-11-14',
    })
    expect(periodBills([seen], periodStart, nextPayday, today)).toEqual([
      expect.objectContaining({ dueDate: '2026-11-14', paid: true, overdue: false }),
    ])
  })

  it('leaves a passed date of a bill Leeway cannot see paid as a plain due date', () => {
    const phone = billOf({ anchorDate: '2026-10-15' })
    expect(periodBills([phone], periodStart, nextPayday, today)).toEqual([
      expect.objectContaining({ dueDate: '2026-11-15', paid: false, overdue: false }),
    ])
  })
})
