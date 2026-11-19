import { describe, expect, it } from 'vitest'
import {
  bankContributions,
  perMonth,
  type TransferCandidate,
} from '../src/domain/savings/contributions.js'
import {
  balanceOn,
  changeOver,
  changesOf,
  combineChanges,
  totalSeries,
  windowStart,
} from '../src/domain/savings/history.js'

const TODAY = '2026-11-19'

describe('windowStart', () => {
  it('starts this month on the first, and the others a fixed number of days back', () => {
    expect(windowStart('month', TODAY)).toBe('2026-11-01')
    expect(windowStart('days30', TODAY)).toBe('2026-10-20')
    expect(windowStart('year', TODAY)).toBe('2025-11-19')
  })
})

describe('balanceOn', () => {
  const points = [
    { day: '2026-10-01', cents: 100 },
    { day: '2026-11-01', cents: 200 },
  ]

  it('takes the last balance on or before the day', () => {
    expect(balanceOn(points, '2026-10-31')).toEqual(points[0])
    expect(balanceOn(points, '2026-11-01')).toEqual(points[1])
  })

  it('is null before history starts', () => {
    expect(balanceOn(points, '2026-09-30')).toBeNull()
  })
})

describe('changeOver', () => {
  const points = [
    { day: '2025-06-01', cents: 50000 },
    { day: '2026-10-15', cents: 90000 },
    { day: '2026-11-05', cents: 95000 },
  ]

  it('measures from the balance at the start of each window', () => {
    expect(changeOver('days30', points, 100000, TODAY)).toEqual({
      changeCents: 10000,
      since: '2026-10-20',
    })
    expect(changeOver('month', points, 100000, TODAY)).toEqual({
      changeCents: 10000,
      since: '2026-11-01',
    })
    expect(changeOver('year', points, 100000, TODAY)).toEqual({
      changeCents: 50000,
      since: '2025-11-19',
    })
    expect(changeOver('all', points, 100000, TODAY)).toEqual({
      changeCents: 50000,
      since: '2025-06-01',
    })
  })

  it('reports a fall as a negative change', () => {
    expect(changeOver('days30', points, 80000, TODAY)?.changeCents).toBe(-10000)
  })

  it('says nothing for a window history does not reach, except this month', () => {
    const recent = [{ day: '2026-11-10', cents: 1000 }]
    expect(changeOver('days30', recent, 1500, TODAY)).toBeNull()
    expect(changeOver('year', recent, 1500, TODAY)).toBeNull()
    expect(changeOver('month', recent, 1500, TODAY)).toEqual({
      changeCents: 500,
      since: '2026-11-10',
    })
  })

  it('says nothing when history starts today or not at all', () => {
    expect(changeOver('all', [], 1500, TODAY)).toBeNull()
    expect(changeOver('month', [{ day: TODAY, cents: 1 }], 1500, TODAY)).toBeNull()
  })

  it('handles a zero balance', () => {
    const empty = [{ day: '2026-01-01', cents: 0 }]
    expect(changesOf(empty, 0, TODAY).year).toBeNull()
    expect(changesOf(empty, 0, TODAY).all).toEqual({ changeCents: 0, since: '2026-01-01' })
  })
})

describe('combineChanges', () => {
  it('adds known changes and counts accounts without history that far back', () => {
    expect(
      combineChanges([
        { changeCents: 100, since: '2026-10-20' },
        null,
        { changeCents: -30, since: '2026-11-02' },
      ]),
    ).toEqual({ changeCents: 70, since: '2026-11-02', accountsLeftOut: 1 })
  })

  it('is null when no account has a change', () => {
    expect(combineChanges([null, null])).toBeNull()
    expect(combineChanges([])).toBeNull()
  })
})

describe('totalSeries', () => {
  it('adds the accounts up on each day a balance changed, carrying balances forward', () => {
    const history = new Map([
      [
        'ira',
        [
          { day: '2026-11-01', cents: 1000 },
          { day: TODAY, cents: 1200 },
        ],
      ],
      [
        'savings',
        [
          { day: '2026-11-10', cents: 500 },
          { day: TODAY, cents: 500 },
        ],
      ],
    ])
    expect(totalSeries(history, '2026-11-01', TODAY)).toEqual([
      { day: '2026-11-01', cents: 1000 },
      { day: '2026-11-10', cents: 1500 },
      { day: TODAY, cents: 1700 },
    ])
  })
})

describe('bankContributions', () => {
  const transfer = (date: string, amountCents: number, code: string): TransferCandidate => ({
    date,
    amountCents,
    providerCategoryDetailed: code,
  })
  const TO_SAVINGS = 'TRANSFER_OUT_SAVINGS'
  const TO_INVESTMENTS = 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS'

  it('adds up transfers the bank labeled, by where they went, per month over a year', () => {
    const result = bankContributions(
      [
        transfer('2026-01-15', 50000, TO_INVESTMENTS),
        transfer('2026-06-15', 50000, TO_INVESTMENTS),
        transfer('2026-11-01', 20000, TO_SAVINGS),
        transfer('2026-11-02', 9900, 'TRANSFER_OUT_ACCOUNT_TRANSFER'),
      ],
      '2024-01-01',
      TODAY,
    )
    expect(result).toEqual({
      since: '2025-11-20',
      totalCents: { cash: 20000, invested: 100000 },
      monthlyCents: { cash: perMonth(20000, 365), invested: perMonth(100000, 365) },
      transferCount: 3,
    })
    expect(result!.monthlyCents!.invested).toBe(8339)
  })

  it('averages over the history Leeway holds when it is shorter than a year', () => {
    const result = bankContributions(
      [transfer('2026-11-01', 30000, TO_SAVINGS)],
      '2026-10-21',
      TODAY,
    )
    expect(result!.since).toBe('2026-10-21')
    expect(result!.monthlyCents!.cash).toBe(perMonth(30000, 30))
  })

  it('gives no monthly figure from less than four weeks of history', () => {
    const result = bankContributions(
      [transfer('2026-11-15', 30000, TO_SAVINGS)],
      '2026-11-10',
      TODAY,
    )
    expect(result!.totalCents.cash).toBe(30000)
    expect(result!.monthlyCents).toBeNull()
  })

  it('subtracts a reversed transfer but never goes below zero', () => {
    const result = bankContributions(
      [transfer('2026-11-01', 20000, TO_SAVINGS), transfer('2026-11-03', -25000, TO_SAVINGS)],
      null,
      TODAY,
    )
    expect(result!.totalCents.cash).toBe(0)
  })

  it('ignores transfers outside the year or with no code, and is null when none were found', () => {
    expect(bankContributions([transfer('2025-11-19', 20000, TO_SAVINGS)], null, TODAY)).toBeNull()
    expect(bankContributions([transfer('2026-11-20', 20000, TO_SAVINGS)], null, TODAY)).toBeNull()
    const uncoded = { ...transfer('2026-11-01', 20000, TO_SAVINGS), providerCategoryDetailed: null }
    expect(bankContributions([uncoded], null, TODAY)).toBeNull()
    expect(bankContributions([], null, TODAY)).toBeNull()
  })
})
