import { describe, expect, it } from 'vitest'
import {
  bankContributions,
  perMonth,
  savingsTransferDestination,
  type TransferCandidate,
} from '../src/domain/savings/contributions.js'
import {
  balanceOn,
  baseDay,
  changeOver,
  changesOf,
  combineAll,
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

describe('baseDay', () => {
  it('measures this month from the close of the day before the 1st, the others from their first day', () => {
    expect(baseDay('month', TODAY)).toBe('2026-10-31')
    expect(baseDay('month', '2026-01-05')).toBe('2025-12-31')
    expect(baseDay('days30', TODAY)).toBe('2026-10-20')
    expect(baseDay('year', TODAY)).toBe('2025-11-19')
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

  it('counts a balance change on the 1st as this month’s', () => {
    // A paycheck moved to savings on the 1st: the month starts before it.
    const paydayFirst = [
      { day: '2026-10-20', cents: 1000 },
      { day: '2026-11-01', cents: 3000 },
    ]
    expect(changeOver('month', paydayFirst, 3500, TODAY)).toEqual({
      changeCents: 2500,
      since: '2026-11-01',
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

  it('adds only changes from the window’s first day, leaving out accounts measured from later', () => {
    const changes = [
      { changeCents: 100, since: '2026-11-01' },
      { changeCents: 50, since: '2026-11-10' },
      null,
    ]
    expect(combineChanges(changes, '2026-11-01')).toEqual({
      changeCents: 100,
      since: '2026-11-01',
      accountsLeftOut: 2,
    })
  })

  it('falls back to the earliest start when no account reaches the window’s first day', () => {
    const changes = [
      { changeCents: 50, since: '2026-11-10' },
      { changeCents: 20, since: '2026-11-05' },
      { changeCents: 30, since: '2026-11-05' },
      null,
    ]
    // Only the two seen since Nov 5 are added; the one seen from Nov 10 is left out.
    expect(combineChanges(changes, '2026-11-01')).toEqual({
      changeCents: 50,
      since: '2026-11-05',
      accountsLeftOut: 2,
    })
  })

  it('is null when no account has a change', () => {
    expect(combineChanges([null, null])).toBeNull()
    expect(combineChanges([null, null], '2026-11-01')).toBeNull()
    expect(combineChanges([])).toBeNull()
  })
})

describe('combineAll', () => {
  it('combines each window from its own first day, and all history from wherever it starts', () => {
    const old = changesOf(
      [
        { day: '2025-06-01', cents: 1000 },
        { day: '2026-10-31', cents: 2000 },
      ],
      2600,
      TODAY,
    )
    // Seen only since the 10th: this month's fallback is left out beside `old`.
    const recent = changesOf([{ day: '2026-11-10', cents: 500 }], 700, TODAY)
    const combined = combineAll([old, recent], TODAY)
    expect(combined.month).toEqual({ changeCents: 600, since: '2026-11-01', accountsLeftOut: 1 })
    expect(combined.year).toEqual({ changeCents: 1600, since: '2025-11-19', accountsLeftOut: 1 })
    expect(combined.all).toEqual({ changeCents: 1800, since: '2026-11-10', accountsLeftOut: 0 })
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

describe('savingsTransferDestination', () => {
  it('names where a savings or investment transfer went, either way, and nothing else', () => {
    expect(savingsTransferDestination('TRANSFER_OUT_SAVINGS')).toBe('cash')
    expect(savingsTransferDestination('TRANSFER_IN_SAVINGS')).toBe('cash')
    expect(savingsTransferDestination('TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS')).toBe(
      'invested',
    )
    expect(savingsTransferDestination('TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS')).toBe(
      'invested',
    )
    expect(savingsTransferDestination('TRANSFER_OUT_ACCOUNT_TRANSFER')).toBeNull()
    expect(savingsTransferDestination(null)).toBeNull()
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

  it('nets money moved back out of savings and investments against what went in', () => {
    const result = bankContributions(
      [
        transfer('2026-10-01', 100000, TO_SAVINGS),
        // A withdrawal lands in checking as money in, labeled as from savings.
        transfer('2026-10-15', -60000, 'TRANSFER_IN_SAVINGS'),
        transfer('2026-10-02', 50000, TO_INVESTMENTS),
        transfer('2026-10-20', -20000, 'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS'),
      ],
      '2024-01-01',
      TODAY,
    )
    expect(result).toMatchObject({
      totalCents: { cash: 40000, invested: 30000 },
      monthlyCents: { cash: perMonth(40000, 365), invested: perMonth(30000, 365) },
      // Only money put in counts as a transfer made.
      transferCount: 2,
    })
  })

  it('finds nothing to report from withdrawals alone', () => {
    expect(
      bankContributions([transfer('2026-11-01', -20000, 'TRANSFER_IN_SAVINGS')], null, TODAY),
    ).toBeNull()
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
