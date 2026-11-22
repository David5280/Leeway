// Duplicate charges (leaks/duplicates.ts): the same merchant charging one
// account the same amount more than once within a few days, unless that is a
// habit there or refunds put it right.

import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_DAYS,
  DUPLICATE_HISTORY_DAYS,
  DUPLICATE_NEWS_DAYS,
  findDoubleCharges,
  findDuplicates,
  HABIT_DAYS,
  type ChargeLine,
} from '../src/domain/leaks/duplicates.js'

const TODAY = '2026-11-17'

let next = 0

/** A posted charge on the checking account; negative amounts are refunds. */
const line = (date: string, amountCents: number, fields: Partial<ChargeLine> = {}): ChargeLine => {
  next += 1
  return {
    id: `tx-${String(next).padStart(3, '0')}`,
    accountId: 'checking',
    date,
    name: 'NETFLIX.COM 8473 CA',
    merchantName: 'Netflix',
    amountCents,
    ...fields,
  }
}

const dates = (found: ReturnType<typeof findDuplicates>) =>
  found.map((duplicate) => duplicate.charges.map((charge) => charge.date))

describe('findDuplicates', () => {
  it('finds the same charge twice within a few days, oldest first', () => {
    const found = findDuplicates([line('2026-11-03', 1549), line('2026-11-04', 1549)], TODAY)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ accountId: 'checking' })
    expect(dates(found)).toEqual([['2026-11-03', '2026-11-04']])
  })

  it(`counts charges up to ${DUPLICATE_DAYS} days apart, and no further`, () => {
    expect(DUPLICATE_DAYS).toBe(3)
    expect(
      findDuplicates([line('2026-11-01', 4210), line('2026-11-04', 4210)], TODAY),
    ).toHaveLength(1)
    expect(findDuplicates([line('2026-11-01', 4210), line('2026-11-05', 4210)], TODAY)).toEqual([])
  })

  it('gathers three of the same charge into one duplicate', () => {
    const found = findDuplicates(
      [line('2026-11-03', 999), line('2026-11-03', 999), line('2026-11-05', 999)],
      TODAY,
    )
    expect(dates(found)).toEqual([['2026-11-03', '2026-11-03', '2026-11-05']])
  })

  it('needs the same amount, the same merchant and the same account', () => {
    expect(findDuplicates([line('2026-11-03', 1549), line('2026-11-04', 1550)], TODAY)).toEqual([])
    const other = { name: 'HULU 555', merchantName: 'Hulu' }
    expect(
      findDuplicates([line('2026-11-03', 1549), line('2026-11-04', 1549, other)], TODAY),
    ).toEqual([])
    expect(
      findDuplicates(
        [line('2026-11-03', 1549), line('2026-11-04', 1549, { accountId: 'card' })],
        TODAY,
      ),
    ).toEqual([])
  })

  it('reads the merchant from the bank text when no merchant name came', () => {
    const plain = { name: 'BLUE BOTTLE COFFEE 0412', merchantName: null }
    const found = findDuplicates(
      [line('2026-11-10', 1275, plain), line('2026-11-10', 1275, plain)],
      TODAY,
    )
    expect(found).toHaveLength(1)
  })

  it('leaves a routine purchase alone: the same amount there on many other days', () => {
    const coffee = { name: 'CORNER CAFE', merchantName: 'Corner Cafe' }
    const habit = [
      '2026-10-02',
      '2026-10-09',
      '2026-10-16',
      '2026-10-23',
      '2026-11-10',
      '2026-11-11',
    ]
    expect(
      findDuplicates(
        habit.map((d) => line(d, 525, coffee)),
        TODAY,
      ),
    ).toEqual([])
  })

  it('leaves a merchant alone that charges the amount twice close together as a pattern', () => {
    // Paid in two equal parts each month, a few days apart.
    const split = [
      '2026-09-01',
      '2026-09-03',
      '2026-10-01',
      '2026-10-03',
      '2026-11-01',
      '2026-11-03',
    ]
    expect(
      findDuplicates(
        split.map((d) => line(d, 60000)),
        TODAY,
      ),
    ).toEqual([])
  })

  it('still finds a monthly subscription charged twice in one month', () => {
    const found = findDuplicates(
      [
        line('2026-09-04', 1549),
        line('2026-10-04', 1549),
        line('2026-11-04', 1549),
        line('2026-11-05', 1549),
      ],
      TODAY,
    )
    expect(dates(found)).toEqual([['2026-11-04', '2026-11-05']])
  })

  it('leaves out a duplicate one of whose two charges was refunded since', () => {
    const lines = [line('2026-11-03', 4210), line('2026-11-04', 4210), line('2026-11-08', -4210)]
    expect(findDuplicates(lines, TODAY)).toEqual([])
  })

  it('still finds it when the refund is for another amount or came before', () => {
    const partial = [line('2026-11-03', 4210), line('2026-11-04', 4210), line('2026-11-08', -1000)]
    expect(findDuplicates(partial, TODAY)).toHaveLength(1)
    const earlier = [line('2026-10-20', -4210), line('2026-11-03', 4210), line('2026-11-04', 4210)]
    expect(findDuplicates(earlier, TODAY)).toHaveLength(1)
  })

  it('takes one charge off a run of three for one refund, still pointing at the latest', () => {
    const run = [line('2026-11-03', 999), line('2026-11-04', 999), line('2026-11-05', 999)]
    const [found] = findDuplicates([...run, line('2026-11-09', -999)], TODAY)
    expect(found!.charges).toEqual(run.slice(1))
    expect(
      findDuplicates([...run, line('2026-11-09', -999), line('2026-11-10', -999)], TODAY),
    ).toEqual([])
  })

  it('counts a refund only from the same merchant and account', () => {
    const lines = [
      line('2026-11-03', 4210),
      line('2026-11-04', 4210),
      line('2026-11-08', -4210, { name: 'HULU', merchantName: 'Hulu' }),
      line('2026-11-08', -4210, { accountId: 'card' }),
    ]
    expect(findDuplicates(lines, TODAY)).toHaveLength(1)
  })

  it(`stops being news after ${DUPLICATE_NEWS_DAYS} days`, () => {
    const old = [line('2026-10-10', 4210), line('2026-10-11', 4210)]
    expect(findDuplicates(old, TODAY)).toEqual([])
    expect(findDuplicates(old, '2026-11-09')).toHaveLength(1)
  })

  it('ignores money in and lines with no merchant left', () => {
    expect(findDuplicates([line('2026-11-03', -5000), line('2026-11-04', -5000)], TODAY)).toEqual(
      [],
    )
    const unnamed = { name: '#### 1234', merchantName: null }
    expect(
      findDuplicates([line('2026-11-03', 500, unnamed), line('2026-11-04', 500, unnamed)], TODAY),
    ).toEqual([])
  })

  it(`reads enough history for the habit window of the oldest duplicate still news`, () => {
    expect(DUPLICATE_HISTORY_DAYS).toBe(HABIT_DAYS + DUPLICATE_NEWS_DAYS + DUPLICATE_DAYS)
  })

  describe('a habit judged from when the charges were made, not from today', () => {
    // A $4.50 coffee every five days in late summer, then two on Nov 19.
    const coffee = { name: 'CORNER CAFE', merchantName: 'Corner Cafe' }
    const lines = () =>
      ['2026-08-24', '2026-08-29', '2026-09-03', '2026-09-08', '2026-11-19', '2026-11-19'].map(
        (date) => line(date, 450, coffee),
      )

    it('stays a habit the day after and a week after, never raising a late alert', () => {
      expect(findDuplicates(lines(), '2026-11-20')).toEqual([])
      expect(findDuplicates(lines(), '2026-11-25')).toEqual([])
      // As long as it is news at all.
      expect(findDuplicates(lines(), '2026-12-18')).toEqual([])
    })

    it(`no longer counts days more than ${HABIT_DAYS} days before the charges`, () => {
      // The same two on Nov 25 instead: the earliest coffee is now 93 days before them.
      const later = lines().map((one, i) => (i >= 4 ? { ...one, date: '2026-11-25' } : one))
      expect(findDuplicates(later, '2026-11-26')).toHaveLength(1)
    })
  })

  it('lists the newest duplicate first', () => {
    const hulu = { name: 'HULU', merchantName: 'Hulu' }
    const found = findDuplicates(
      [
        line('2026-11-01', 1549),
        line('2026-11-02', 1549),
        line('2026-11-12', 799, hulu),
        line('2026-11-12', 799, hulu),
      ],
      TODAY,
    )
    expect(dates(found)).toEqual([
      ['2026-11-12', '2026-11-12'],
      ['2026-11-01', '2026-11-02'],
    ])
  })
})

describe('findDoubleCharges', () => {
  it('keeps a refunded double charge, which still tells a bill paid twice', () => {
    const lines = [line('2026-11-03', 4210), line('2026-11-04', 4210), line('2026-11-08', -4210)]
    expect(findDuplicates(lines, TODAY)).toEqual([])
    expect(dates(findDoubleCharges(lines, TODAY))).toEqual([['2026-11-03', '2026-11-04']])
  })

  it('still leaves out a habit and a charge no longer news', () => {
    const old = [line('2026-10-10', 4210), line('2026-10-11', 4210)]
    expect(findDoubleCharges(old, TODAY)).toEqual([])
    const split = ['2026-10-01', '2026-10-03', '2026-11-01', '2026-11-03'].map((d) => line(d, 600))
    expect(findDoubleCharges(split, TODAY)).toEqual([])
  })
})
