// Finding yearly and irregular costs worth a sinking fund, and the steady
// share of each to put by. Pure. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import type { Bill } from '../src/domain/bills.js'
import type { PastTransaction, RecurringSeries } from '../src/domain/recurring.js'
import {
  billFunds,
  fundSuggestions,
  holidayFund,
  HOLIDAYS_KEY,
  renewalFunds,
  repeatingFunds,
  shownKey,
  type FundSuggestion,
} from '../src/domain/sinkingFunds/detect.js'
import { nextDue, shareOf } from '../src/domain/sinkingFunds/math.js'

const TODAY = '2026-11-17'

function bill(fields: Partial<Bill>): Bill {
  return {
    id: 'bill-1',
    name: 'Car insurance',
    amountCents: 72_000,
    cadence: 'year',
    nextDueDate: '2027-03-01',
    lastPaidDate: '2026-03-01',
    ...fields,
  } as Bill
}

function series(fields: Partial<RecurringSeries>): RecurringSeries {
  return {
    key: 'cloud storage',
    name: 'Cloud Storage',
    direction: 'out',
    cadence: 'year',
    typicalAmountCents: 9_999,
    amountVaries: false,
    count: 2,
    lastDate: '2025-12-02',
    nextDate: '2026-12-02',
    categoryId: null,
    ...fields,
  } as RecurringSeries
}

const charge = (date: string, name: string, amountCents: number): PastTransaction => ({
  date,
  name,
  merchantName: null,
  amountCents,
  categoryId: null,
})

const shownName = (tx: PastTransaction) => tx.name.toLowerCase()

describe('shareOf and nextDue', () => {
  it('spreads a cost evenly over its cycle, rounding up a cent', () => {
    expect(shareOf({ amountCents: 120_000, cadence: 'year' }, 'month')).toBe(10_000)
    // Every two weeks: $1,200 over 26.09 paychecks.
    expect(shareOf({ amountCents: 120_000, cadence: 'year' }, 'biweek')).toBe(4_600)
    expect(shareOf({ amountCents: 30_000, cadence: 'quarter' }, 'month')).toBe(10_000)
  })

  it('finds the next due date, today counting', () => {
    expect(nextDue({ cadence: 'year', anchorDate: '2020-03-01' }, TODAY)).toBe('2027-03-01')
    expect(nextDue({ cadence: 'quarter', anchorDate: '2026-11-17' }, TODAY)).toBe(TODAY)
  })
})

describe('billFunds', () => {
  it('suggests tracked yearly and quarterly bills, never monthly ones', () => {
    const found = billFunds([bill({}), bill({ id: 'bill-2', name: 'Phone', cadence: 'month' })])
    expect(found).toEqual([
      {
        key: 'bill:bill-1',
        name: 'Car insurance',
        amountCents: 72_000,
        cadence: 'year',
        dueDate: '2027-03-01',
        basis: 'bill',
        lastDate: '2026-03-01',
      },
    ])
  })
})

describe('repeatingFunds', () => {
  it('suggests charges repeating yearly or quarterly, keyed by the shown name', () => {
    const found = repeatingFunds(
      [
        series({}),
        series({ name: 'Water', cadence: 'quarter', lastDate: '2026-08-10' }),
        series({ name: 'Gym', cadence: 'month' }),
        series({ name: 'Dividend', direction: 'in' }),
      ],
      TODAY,
    )
    expect(found.map((f) => [f.key, f.cadence, f.dueDate])).toEqual([
      ['name:cloud storage', 'year', '2026-12-02'],
      // Due Nov 10 has passed, so the next is in February.
      ['name:water', 'quarter', '2027-02-10'],
    ])
    expect(found[0]!.basis).toBe('repeating')
  })
})

describe('renewalFunds', () => {
  it('suggests one large charge about a year ago that reads like a renewal', () => {
    const history = [charge('2025-12-20', 'STATE FARM INSURANCE PREMIUM', 64_000)]
    expect(renewalFunds(history, TODAY, shownName)).toEqual([
      {
        key: shownKey('state farm insurance premium'),
        name: 'state farm insurance premium',
        amountCents: 64_000,
        cadence: 'year',
        dueDate: '2026-12-20',
        basis: 'renewal',
        lastDate: '2025-12-20',
      },
    ])
  })

  it('leaves out small charges, ones too old or too new, other words, and refunds', () => {
    const history = [
      charge('2025-12-20', 'DMV REGISTRATION', 3_000),
      charge('2025-08-01', 'ANNUAL MEMBERSHIP', 20_000),
      charge('2026-06-01', 'ANNUAL MEMBERSHIP CLUB', 20_000),
      charge('2025-12-20', 'BIG TV STORE', 90_000),
      charge('2025-12-21', 'HOME INSURANCE', -40_000),
    ]
    expect(renewalFunds(history, TODAY, shownName)).toEqual([])
  })

  it('goes by the newest charge from a merchant, so one charged again since is not due', () => {
    const history = [
      charge('2025-12-01', 'PET INSURANCE', 8_000),
      charge('2026-10-01', 'PET INSURANCE', 8_000),
    ]
    expect(renewalFunds(history, TODAY, shownName)).toEqual([])
  })
})

describe('holidayFund', () => {
  /** A month of spending: one charge on its 10th. */
  const month = (yearMonth: string, cents: number) => charge(`${yearMonth}-10`, 'SHOP', cents)
  const usualYear = (december: number) => [
    charge('2025-07-28', 'SHOP', 1_000),
    month('2025-08', 200_000),
    month('2025-09', 210_000),
    month('2025-10', 190_000),
    month('2025-11', 200_000),
    month('2025-12', december),
    month('2026-01', 205_000),
    month('2026-11', 999_999),
  ]

  it('suggests saving for the holidays when December ran well above a usual month', () => {
    expect(holidayFund(usualYear(290_000), TODAY)).toEqual({
      key: HOLIDAYS_KEY,
      name: 'Holidays',
      // $875 above a usual $2,025, rounded up to $50.
      amountCents: 90_000,
      cadence: 'year',
      dueDate: '2026-12-01',
      basis: 'holidays',
      lastDate: null,
    })
  })

  it('looks to next December once this one has begun', () => {
    expect(holidayFund(usualYear(290_000), '2026-12-05')?.dueDate).toBe('2027-12-01')
  })

  it('says nothing for a December near usual, too little history, or none at all', () => {
    expect(holidayFund(usualYear(210_000), TODAY)).toBeNull()
    expect(holidayFund(usualYear(290_000).slice(3), TODAY)).toBeNull()
    expect(holidayFund([], TODAY)).toBeNull()
  })
})

describe('fundSuggestions', () => {
  const one = (key: string, basis: FundSuggestion['basis']): FundSuggestion => ({
    key,
    name: key,
    amountCents: 10_000,
    cadence: 'year',
    dueDate: '2027-01-01',
    basis,
    lastDate: null,
  })

  it('lists the surest first, each cost once, leaving out ones added or dismissed', () => {
    const found = fundSuggestions(
      {
        bills: [one('bill:1', 'bill')],
        repeating: [one('name:a', 'repeating'), one('name:b', 'repeating')],
        renewals: [one('name:a', 'renewal')],
        holidays: one(HOLIDAYS_KEY, 'holidays'),
      },
      new Set(['name:b']),
    )
    expect(found.map((f) => [f.key, f.basis])).toEqual([
      ['bill:1', 'bill'],
      ['name:a', 'repeating'],
      [HOLIDAYS_KEY, 'holidays'],
    ])
    expect(
      fundSuggestions({ bills: [], repeating: [], renewals: [], holidays: null }, new Set()),
    ).toEqual([])
  })
})
