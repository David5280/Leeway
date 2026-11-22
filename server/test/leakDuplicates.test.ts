// Duplicate charges (leaks/duplicates.ts): the same merchant charging one
// account the same amount more than once within a few days, unless that is a
// habit there or one of them was refunded.

import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_DAYS,
  DUPLICATE_NEWS_DAYS,
  findDuplicates,
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

  it('leaves out a duplicate one of whose charges was refunded since', () => {
    const lines = [line('2026-11-03', 4210), line('2026-11-04', 4210), line('2026-11-08', -4210)]
    expect(findDuplicates(lines, TODAY)).toEqual([])
  })

  it('still finds it when the refund is for another amount or came before', () => {
    const partial = [line('2026-11-03', 4210), line('2026-11-04', 4210), line('2026-11-08', -1000)]
    expect(findDuplicates(partial, TODAY)).toHaveLength(1)
    const earlier = [line('2026-10-20', -4210), line('2026-11-03', 4210), line('2026-11-04', 4210)]
    expect(findDuplicates(earlier, TODAY)).toHaveLength(1)
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
