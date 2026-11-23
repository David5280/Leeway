import { describe, expect, it } from 'vitest'
import type { NetWorth } from '../../api/client'
import { cashFlow, debtPlans } from '../../test/planning'
import { mathSentence } from '../drill'
import { money as formatMoney } from '../money'
import { cashFlowDrill, debtsDrill, merchantsDrill, netWorthDrill } from './plan'
import { worthPoint } from '../../test/worth'

/** Whole dollars, as the app shows amounts in drill-downs. */
const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })
const said = (drill: { math: Parameters<typeof mathSentence>[0] }) =>
  mathSentence(drill.math, money)
const date = (iso: string) => `on ${iso}`
const duration = (months: number | null) => (months === null ? 'Never' : `${months} months`)

describe('cashFlowDrill', () => {
  it('takes the bills due before payday from checking, leaving what is safe to spend', () => {
    const drill = cashFlowDrill(cashFlow(), date)
    expect(said(drill)).toBe(
      'Safe to spend $1,440 = In checking $1,500 minus bills due before payday $60',
    )
    expect(drill.subtitle).toBe('Payday on 2026-11-27')
    expect(drill.figure).toEqual({ cents: 144000 })
    expect(drill.math.note).toBe(
      'Day-to-day spending until payday comes out of this. Savings is not counted.',
    )
    expect(drill.items!.rows).toEqual([
      {
        key: 'bill-phone-2026-11-20',
        label: 'Phone',
        detail: 'Due on 2026-11-20',
        value: { cents: 6000 },
        to: '/plan/bills',
      },
    ])
    expect(drill.more).toEqual({ to: '/plan', label: 'Open the plan' })
  })

  it('says by how much the cash falls short, in red, and names an overdue bill', () => {
    const late = { billId: 'r', name: 'Rent', dueDate: '2026-11-01', amountCents: 9000 }
    const drill = cashFlowDrill(
      cashFlow({
        cashCents: 5000,
        billsDue: [{ ...late, overdue: true }],
        billsDueCents: 9000,
        safeCents: 0,
        shortfallCents: 4000,
      }),
      date,
    )
    expect(drill.math.result).toEqual({
      label: 'Short by',
      value: { cents: 4000, tone: 'problem' },
    })
    expect(drill.figure).toEqual({ cents: 4000, tone: 'problem' })
    expect(drill.math.note).toBe('The bills due before payday come to more than checking holds.')
    expect(drill.items!.rows[0]!.detail).toBe('No payment found yet')
  })

  it('takes out an overdraft, and says when payday is an estimate or the period end', () => {
    const overdrawn = cashFlowDrill(
      cashFlow({ overdraftCents: 10_000, safeCents: 134_000, paydayEstimate: true }),
      date,
    )
    expect(said(overdrawn)).toBe(
      'Safe to spend $1,340 = In checking $1,500 minus bills due before payday $60 minus to bring an overdraft back to zero $100',
    )
    expect(overdrawn.subtitle).toBe(
      'Payday about on 2026-11-27, a best guess until more paychecks come',
    )
    const end = cashFlowDrill(cashFlow({ paydaySource: 'period_end' }), date)
    expect(end.subtitle).toBe('To on 2026-11-27, when the budget period ends')
  })

  it('says a shortfall against a guessed payday may be, in amber, not red', () => {
    const drill = cashFlowDrill(
      cashFlow({ cashCents: 5000, billsDueCents: 9000, safeCents: 0, shortfallCents: 4000 }),
      date,
    )
    expect(drill.figure).toEqual({ cents: 4000, tone: 'problem' })
    const guess = cashFlowDrill(
      cashFlow({
        cashCents: 5000,
        billsDueCents: 9000,
        safeCents: 0,
        shortfallCents: 4000,
        paydayEstimate: true,
      }),
      date,
    )
    expect(guess.figure).toEqual({ cents: 4000, tone: 'warn' })
    expect(guess.math.result.value).toEqual({ cents: 4000, tone: 'warn' })
    expect(guess.math.note).toBe(
      'The bills due before payday may come to more than checking holds.',
    )
  })

  it('says an overdraft alone is what falls short, with no bills due', () => {
    const drill = cashFlowDrill(
      cashFlow({
        cashCents: 0,
        billsDue: [],
        billsDueCents: 0,
        overdraftCents: 2500,
        safeCents: 0,
        shortfallCents: 2500,
      }),
      date,
    )
    expect(drill.math.note).toBe('An overdrawn account needs this much to get back to zero.')
    const both = cashFlowDrill(
      cashFlow({ cashCents: 0, overdraftCents: 2500, safeCents: 0, shortfallCents: 8500 }),
      date,
    )
    expect(both.math.note).toBe(
      'The bills and the overdraft due before payday come to more than checking holds.',
    )
  })

  it('says what is not known with no checking balance, never $0', () => {
    const drill = cashFlowDrill(cashFlow({ cashKnown: false, cashCents: 0, safeCents: 0 }), date)
    expect(drill.figure).toEqual({ text: 'Not known yet' })
    expect(said(drill)).toBe(
      'Safe to spend Not known yet = In checking Not known yet minus bills due before payday $60',
    )
    expect(drill.math.note).toBe(
      "Checking's balance isn't known yet, so what is safe to spend isn't either.",
    )
  })

  it('lists no bills when none are due', () => {
    const drill = cashFlowDrill(cashFlow({ daysUntilPayday: 0, billsDue: [] }), date)
    expect(drill.items).toBeUndefined()
  })
})

describe('netWorthDrill', () => {
  const worth: NetWorth = {
    assetsCents: 900000,
    liabilitiesCents: 200000,
    netWorthCents: 700000,
    history: [worthPoint('2026-01-01', 500000), worthPoint('2026-11-17', 700000)],
    historyStart: '2026-01-01',
    estimatedBefore: null,
  }

  it('takes what is owed from what is owned, with the year as its trend', () => {
    const drill = netWorthDrill(worth)
    expect(said(drill)).toBe('Net worth $7,000 = What you own $9,000 minus what you owe $2,000')
    expect(drill.trend!.points).toEqual([
      { date: '2026-01-01', cents: 500000 },
      { date: '2026-11-17', cents: 700000 },
    ])
    expect(drill.more).toEqual({ to: '/plan/net-worth', label: 'Open net worth' })
  })

  it('reads a negative net worth in red, with no trend from one day', () => {
    const drill = netWorthDrill({
      ...worth,
      netWorthCents: -5000,
      history: [worthPoint('2026-11-17', -5000)],
    })
    expect(drill.figure).toEqual({ cents: -5000, tone: 'problem' })
    expect(drill.math.result.value).toEqual({ cents: -5000, tone: 'problem' })
    expect(drill.trend).toBeUndefined()
  })
})

describe('debtsDrill', () => {
  const card = {
    id: 'card',
    name: 'Rewards card',
    balanceCents: 200000,
    aprBps: 2499,
    minimumCents: 6000,
  }

  it('adds the interest to what is owed, and says when each debt clears', () => {
    const plans = debtPlans([card])
    const drill = debtsDrill(plans, duration)
    const interest = plans.avalanche.totalInterestCents
    expect(drill.math.terms.map((term) => term.value)).toEqual([
      { cents: 200000 },
      { cents: interest },
    ])
    expect(drill.math.result.value).toEqual({ cents: 200000 + interest })
    expect(drill.figure).toEqual({ text: `${plans.avalanche.months} months` })
    expect(drill.items!.rows).toEqual([
      {
        key: 'card',
        label: 'Rewards card',
        detail: `${plans.avalanche.debts[0]!.months} months`,
        value: { cents: plans.avalanche.debts[0]!.interestCents },
        to: '/plan/debts',
      },
    ])
    expect(drill.more).toEqual({ to: '/plan/debts', label: 'Plan it' })
  })
})

describe('merchantsDrill', () => {
  const spent = (merchant: string, spentCents: number, count = 1) => ({
    merchant,
    spentCents,
    count,
  })

  it('names the four biggest and adds up the rest', () => {
    const drill = merchantsDrill([
      spent('Costco', 10000, 3),
      spent('Sweet Cow', 2500, 2),
      spent('Target', 2000),
      spent('Shell', 1500),
      spent('Arcade', 500),
      spent('Bakery', 300),
    ])
    expect(said(drill)).toBe(
      'Spent at these merchants $168 = Costco $100 plus Sweet Cow $25 plus Target $20 plus Shell $15 plus the rest $8',
    )
    expect(drill.figure).toEqual({ cents: 16800 })
    expect(drill.items!.rows.slice(0, 2).map((row) => row.detail)).toEqual([
      '3 charges',
      '2 charges',
    ])
    expect(drill.items!.rows[2]!.detail).toBe('1 charge')
    expect(drill.more).toEqual({ to: '/transactions', label: 'See the transactions' })
  })

  it('has no rest term with four or fewer, and says when nothing was spent', () => {
    expect(merchantsDrill([spent('Costco', 10000)]).math.terms).toHaveLength(1)
    const none = merchantsDrill([])
    expect(said(none)).toBe('Spent at these merchants $0 = No spending yet $0')
    expect(none.items).toBeUndefined()
  })
})
