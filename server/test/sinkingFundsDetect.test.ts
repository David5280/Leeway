// Finding yearly and irregular costs worth a sinking fund, and the steady
// share of each to put by. Pure. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import type { Bill } from '../src/domain/bills.js'
import type { PastTransaction } from '../src/domain/recurringSeries.js'
import {
  billFunds,
  fundSuggestions,
  holidayFund,
  HOLIDAYS_KEY,
  renewalFunds,
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
    ...fields,
  } as Bill
}

const charge = (date: string, name: string, amountCents: number): PastTransaction => ({
  date,
  name,
  merchantName: null,
  amountCents,
  categoryId: null,
})

const shown = (tx: PastTransaction) => ({ name: tx.name.toLowerCase() })

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
  it('suggests tracked yearly and quarterly bills by id, never monthly ones', () => {
    const found = billFunds([bill({}), bill({ id: 'bill-2', name: 'Phone', cadence: 'month' })])
    expect(found).toEqual([
      {
        key: 'bill:bill-1',
        billId: 'bill-1',
        name: 'Car insurance',
        amountCents: 72_000,
        cadence: 'year',
        dueDate: '2027-03-01',
        basis: 'bill',
      },
    ])
  })
})

describe('renewalFunds', () => {
  it('suggests one large charge about a year ago that reads like a renewal', () => {
    const history = [charge('2025-12-20', 'STATE FARM INSURANCE PREMIUM', 64_000)]
    expect(renewalFunds(history, TODAY, shown)).toEqual([
      {
        key: shownKey('state farm insurance premium'),
        billId: null,
        name: 'state farm insurance premium',
        amountCents: 64_000,
        cadence: 'year',
        dueDate: '2026-12-20',
        basis: 'renewal',
      },
    ])
  })

  it('carries the label a model reads in place of a name that could be anyone’s', () => {
    const history = [charge('2025-12-20', 'JANE DOE ANNUAL MEMBERSHIP', 20_000)]
    const found = renewalFunds(history, TODAY, () => ({ name: 'Jane Doe', modelLabel: 'Payment' }))
    expect(found[0]).toMatchObject({ name: 'Jane Doe', modelLabel: 'Payment' })
  })

  it('leaves out small charges, ones too old or too new, other words, refunds and people', () => {
    const history = [
      charge('2025-12-20', 'DMV REGISTRATION', 3_000),
      charge('2025-08-01', 'ANNUAL MEMBERSHIP', 20_000),
      charge('2026-06-01', 'ANNUAL MEMBERSHIP CLUB', 20_000),
      charge('2025-12-20', 'BIG TV STORE', 90_000),
      charge('2025-12-21', 'HOME INSURANCE', -40_000),
    ]
    expect(renewalFunds(history, TODAY, shown)).toEqual([])
    const sent = [charge('2025-12-20', 'ZELLE INSURANCE SHARE', 30_000)]
    expect(renewalFunds(sent, TODAY, () => null)).toEqual([])
  })

  it('goes by the newest charge from a merchant, so one charged again since is not due', () => {
    const history = [
      charge('2025-12-01', 'PET INSURANCE', 8_000),
      charge('2026-10-01', 'PET INSURANCE', 8_000),
    ]
    expect(renewalFunds(history, TODAY, shown)).toEqual([])
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
      billId: null,
      name: 'Holidays',
      // $875 above a usual $2,025, rounded up to $50.
      amountCents: 90_000,
      cadence: 'year',
      dueDate: '2026-12-01',
      basis: 'holidays',
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
    billId: null,
    name: key,
    amountCents: 10_000,
    cadence: 'year',
    dueDate: '2027-01-01',
    basis,
  })

  it('keeps the order given, each cost once, leaving out ones added or dismissed', () => {
    const found = fundSuggestions(
      [
        one('bill:1', 'bill'),
        one('name:a', 'renewal'),
        one('name:a', 'renewal'),
        one('name:b', 'renewal'),
        null,
        one(HOLIDAYS_KEY, 'holidays'),
      ],
      new Set(['name:b']),
    )
    expect(found.map((f) => f.key)).toEqual(['bill:1', 'name:a', HOLIDAYS_KEY])
    expect(fundSuggestions([null], new Set())).toEqual([])
  })
})
