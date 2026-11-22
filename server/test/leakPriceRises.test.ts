// Price rises on repeating charges no bill tracks (leaks/priceRises.ts):
// only a clear rise over a steady price, on the usual cycle, once, while it
// is news.

import { describe, expect, it } from 'vitest'
import { CHARGES_READ } from '../src/domain/billChanges.js'
import { addDays } from '../src/lib/dates.js'
import type { Cadence } from '../src/lib/periods.js'
import {
  findPriceRises,
  isPriceRise,
  PRICE_RISE,
  priceRiseOf,
  RISE_NEWS_DAYS,
  type RepeatingCharge,
} from '../src/domain/leaks/priceRises.js'

const TODAY = '2026-11-17'

/** Spotify's charges, oldest first, as [date, cents], monthly unless told. */
const spotify = (charges: [string, number][], cadence: Cadence = 'month'): RepeatingCharge => ({
  name: 'Spotify',
  cadence,
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

describe('priceRiseOf on a charge whose amount moves', () => {
  it('stays quiet for a utility whose two charges before the latest happen to agree', () => {
    // Power at $85, $112, $97, $140, $101, $102, then $125: no steady price to rise from.
    const power = spotify([
      ['2026-05-17', 8500],
      ['2026-06-17', 11200],
      ['2026-07-17', 9700],
      ['2026-08-17', 14000],
      ['2026-09-17', 10100],
      ['2026-10-17', 10200],
      ['2026-11-17', 12500],
    ])
    expect(priceRiseOf(power, TODAY)).toBeNull()
  })

  it('still finds a rise on a plan whose price went up once before', () => {
    const twice = spotify([
      ['2026-05-12', 999],
      ['2026-06-12', 999],
      ['2026-07-12', 999],
      ['2026-08-12', 1099],
      ['2026-09-12', 1099],
      ['2026-10-12', 1099],
      ['2026-11-12', 1199],
    ])
    expect(priceRiseOf(twice, TODAY)).toMatchObject({ previousCents: 1099 })
  })

  it(`reads only the last ${CHARGES_READ} cycles, as bill changes do`, () => {
    // Weekly: twenty weeks swinging between $10 and $15, then eleven steady at $12, then $13.
    const amounts = [
      ...Array.from({ length: 20 }, (_, i) => (i % 2 ? 1500 : 1000)),
      ...Array.from({ length: CHARGES_READ - 1 }, () => 1200),
      1300,
    ]
    const weeks = amounts.map((cents, i): [string, number] => [addDays('2026-04-07', 7 * i), cents])
    expect(weeks.at(-1)![0]).toBe('2026-11-10')
    expect(priceRiseOf(spotify(weeks, 'week'), TODAY)).toMatchObject({ previousCents: 1200 })
  })
})

describe('priceRiseOf on a charge off the cycle', () => {
  /** A monthly gym at $15 on the 17th through October, with these later charges added. */
  const gym = (later: [string, number][]) =>
    spotify([
      ['2026-07-17', 1500],
      ['2026-08-17', 1500],
      ['2026-09-17', 1500],
      ['2026-10-17', 1500],
      ...later,
    ])

  it('never reads an annual fee days after the monthly charge as a new price', () => {
    expect(
      priceRiseOf(
        gym([
          ['2026-11-17', 1500],
          ['2026-11-20', 4999],
        ]),
        '2026-11-21',
      ),
    ).toBeNull()
  })

  it('never reads one mid-cycle as a new price either', () => {
    expect(priceRiseOf(gym([['2026-11-04', 4999]]), TODAY)).toBeNull()
  })

  it('skips an extra between two cycles, finding a real rise after it', () => {
    const rise = priceRiseOf(
      gym([
        ['2026-11-04', 4999],
        ['2026-11-17', 1800],
      ]),
      TODAY,
    )
    expect(rise).toMatchObject({ previousCents: 1500, charge: { date: '2026-11-17' } })
  })

  it('looks past an extra a cycle back, too', () => {
    const rise = priceRiseOf(
      gym([
        ['2026-10-20', 4999],
        ['2026-11-17', 1800],
      ]),
      TODAY,
    )
    expect(rise).toMatchObject({ previousCents: 1500 })
  })

  it('looks past an extra just before the charge a cycle back, as by the calendar', () => {
    // Both Oct 15 and Oct 17 are within a month's slack of Nov 17; Oct 17 is the cycle before.
    const rise = priceRiseOf(
      spotify([
        ['2026-08-17', 1500],
        ['2026-09-17', 1500],
        ['2026-10-15', 4999],
        ['2026-10-17', 1500],
        ['2026-11-17', 1800],
      ]),
      TODAY,
    )
    expect(rise).toMatchObject({ previousCents: 1500 })
  })

  it('never reads a fee a few days after the charge as a new price, even a cycle on', () => {
    // A $30 gym on the 1st: Nov 2 and Nov 3 sit within a month's slack of Oct 1,
    // but Nov 1 is the charge due that cycle, so the $50 is an extra.
    const firsts = (extra: string) =>
      spotify([
        ['2026-08-01', 3000],
        ['2026-09-01', 3000],
        ['2026-10-01', 3000],
        ['2026-11-01', 3000],
        [extra, 5000],
      ])
    expect(priceRiseOf(firsts('2026-11-02'), TODAY)).toBeNull()
    expect(priceRiseOf(firsts('2026-11-03'), TODAY)).toBeNull()
    // Past the slack, Nov 6 has nothing a cycle before it.
    expect(priceRiseOf(firsts('2026-11-06'), TODAY)).toBeNull()
  })

  it('never reads such a fee as a new price on months that start mid-month', () => {
    const shifted = spotify([
      ['2026-08-17', 1500],
      ['2026-09-17', 1500],
      ['2026-10-17', 1500],
      ['2026-10-20', 4999],
    ])
    expect(priceRiseOf(shifted, '2026-10-21')).toBeNull()
  })

  it('reads a fee a few days before the charge is due as a rise until that charge posts', () => {
    // A known gap: the Oct 29 fee is where Nov 1 should be, so it reads as a
    // rise. Once Nov 1 posts, the fee is an extra between two cycles.
    const early = [
      ['2026-08-01', 3000],
      ['2026-09-01', 3000],
      ['2026-10-01', 3000],
      ['2026-10-29', 5000],
    ] as [string, number][]
    expect(priceRiseOf(spotify(early), '2026-10-30')).toMatchObject({ previousCents: 3000 })
    expect(priceRiseOf(spotify([...early, ['2026-11-01', 3000]]), TODAY)).toBeNull()
  })

  it('stays quiet after a missed cycle, with nothing a cycle before the latest', () => {
    const missed = spotify([
      ['2026-07-12', 1099],
      ['2026-08-12', 1099],
      ['2026-09-12', 1099],
      ['2026-11-12', 1199],
    ])
    expect(priceRiseOf(missed, TODAY)).toBeNull()
  })

  it('never tells a rise right after a skipped month, not even a cycle later', () => {
    // October was skipped and November rose: December is no longer the first at the new price.
    const skipped = spotify([
      ['2026-08-12', 1099],
      ['2026-09-12', 1099],
      ['2026-11-12', 1199],
      ['2026-12-12', 1199],
    ])
    expect(priceRiseOf(skipped, '2026-12-13')).toBeNull()
  })

  it('reads the cycle the charge repeats on: weekly charges a week apart', () => {
    const weekly = [
      ['2026-10-27', 1000],
      ['2026-11-03', 1000],
      ['2026-11-10', 1200],
    ] as [string, number][]
    expect(priceRiseOf(spotify(weekly, 'week'), TODAY)).toMatchObject({ previousCents: 1000 })
    // The same dates are no monthly cycle.
    expect(priceRiseOf(spotify(weekly, 'month'), TODAY)).toBeNull()
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
