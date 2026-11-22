// Price rises on repeating charges no bill tracks (leaks/priceRises.ts):
// only a clear rise over a steady price, once, while it is news.

import { describe, expect, it } from 'vitest'
import {
  findPriceRises,
  isPriceRise,
  PRICE_RISE,
  priceRiseOf,
  RISE_NEWS_DAYS,
  type RepeatingCharge,
} from '../src/domain/leaks/priceRises.js'

const TODAY = '2026-11-17'

/** Spotify's charges, oldest first, as [date, cents]. */
const spotify = (charges: [string, number][]): RepeatingCharge => ({
  name: 'Spotify',
  charges: charges.map(([date, amountCents], index) => ({
    id: `tx-${index}`,
    accountId: 'card',
    date,
    name: 'SPOTIFY USA',
    merchantName: 'Spotify',
    amountCents,
  })),
})

describe('isPriceRise', () => {
  it('needs both the share and the cents of PRICE_RISE', () => {
    expect(PRICE_RISE).toEqual({ share: 0.05, cents: 100 })
    expect(isPriceRise(1099, 1199)).toBe(true)
    // 99 cents is under a dollar.
    expect(isPriceRise(1099, 1198)).toBe(false)
    // $2 on $50 is only 4%.
    expect(isPriceRise(5000, 5200)).toBe(false)
    expect(isPriceRise(1199, 1099)).toBe(false)
  })
})

describe('priceRiseOf', () => {
  it('finds the first charge at a higher price after a steady one', () => {
    const rise = priceRiseOf(
      spotify([
        ['2026-09-12', 1099],
        ['2026-10-12', 1099],
        ['2026-11-12', 1199],
      ]),
      TODAY,
    )
    expect(rise).toMatchObject({
      name: 'Spotify',
      previousCents: 1099,
      charge: { id: 'tx-2', date: '2026-11-12', amountCents: 1199, accountId: 'card' },
    })
  })

  it('is news once: a second charge at the new price is not a rise', () => {
    const twice = spotify([
      ['2026-09-12', 1099],
      ['2026-10-12', 1199],
      ['2026-11-12', 1199],
    ])
    expect(priceRiseOf(twice, TODAY)).toBeNull()
  })

  it('stays quiet for a charge whose amount moves anyway, or goes down', () => {
    const varies = spotify([
      ['2026-09-12', 8000],
      ['2026-10-12', 9100],
      ['2026-11-12', 9900],
    ])
    expect(priceRiseOf(varies, TODAY)).toBeNull()
    const cheaper = spotify([
      ['2026-09-12', 1199],
      ['2026-10-12', 1199],
      ['2026-11-12', 1099],
    ])
    expect(priceRiseOf(cheaper, TODAY)).toBeNull()
  })

  it('needs two charges at the old price to know it was steady', () => {
    expect(
      priceRiseOf(
        spotify([
          ['2026-10-12', 1099],
          ['2026-11-12', 1199],
        ]),
        TODAY,
      ),
    ).toBeNull()
  })

  it('counts a few cents of tax as the same steady price', () => {
    const taxed = spotify([
      ['2026-09-12', 1099],
      ['2026-10-12', 1108],
      ['2026-11-12', 1299],
    ])
    expect(priceRiseOf(taxed, TODAY)?.previousCents).toBe(1108)
  })

  it('adds up charges on one day, so a split payment is no rise', () => {
    const split = spotify([
      ['2026-09-12', 1099],
      ['2026-10-12', 1099],
      ['2026-11-12', 600],
      ['2026-11-12', 499],
    ])
    expect(priceRiseOf(split, TODAY)).toBeNull()
  })

  it(`stops being news ${RISE_NEWS_DAYS} days after the charge`, () => {
    const rise = spotify([
      ['2026-08-01', 1099],
      ['2026-09-01', 1099],
      ['2026-10-01', 1199],
    ])
    expect(priceRiseOf(rise, '2026-11-15')).not.toBeNull()
    expect(priceRiseOf(rise, '2026-11-16')).toBeNull()
  })
})

describe('findPriceRises', () => {
  it('keeps only the rises, newest first', () => {
    const steady = spotify([
      ['2026-09-12', 1099],
      ['2026-10-12', 1099],
      ['2026-11-12', 1099],
    ])
    const early = {
      ...spotify([
        ['2026-09-02', 1549],
        ['2026-10-02', 1549],
        ['2026-11-02', 1799],
      ]),
      name: 'Netflix',
    }
    const late = spotify([
      ['2026-09-14', 1099],
      ['2026-10-14', 1099],
      ['2026-11-14', 1199],
    ])
    expect(findPriceRises([steady, early, late], TODAY).map((rise) => rise.name)).toEqual([
      'Spotify',
      'Netflix',
    ])
  })
})
