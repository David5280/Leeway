// A bill whose amount varies by nature, like power or water, told by its own
// charges (amountsVary in billChanges.ts): it raises no "bill changed" alert,
// while a steady bill's price change still does, even after a one-off credit,
// late fee or double payment.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  amountsVary,
  billChangeOf,
  VARIES_AFTER_MOVES,
  type WatchedBill,
} from '../src/domain/billChanges.js'
import { addDays } from '../src/lib/dates.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const TODAY = '2026-11-17'
const LATEST = '2026-11-16'

/**
 * A $80 Comcast bill tracked long ago, charged `amounts` (newest first), one
 * charge a cycle back from Nov 16: a month apart, or a week for weekly bills.
 */
function charged(amounts: number[], fields: Partial<WatchedBill> = {}): WatchedBill {
  const daysApart = fields.cadence === 'week' ? 7 : 30
  return {
    id: 'bill-1',
    name: 'Comcast',
    amountCents: 8000,
    cadence: 'month',
    trackedOn: '2025-01-01',
    amountVaries: false,
    ...fields,
    charges: amounts.map((amountCents, cycle) => ({
      accountId: 'checking',
      date: addDays(LATEST, -daysApart * cycle),
      amountCents,
    })),
  }
}

/** A $95 latest charge after these earlier cycles (newest first): a rise on a $80 bill. */
const riseAfter = (earlier: number[], fields: Partial<WatchedBill> = {}) =>
  billChangeOf(charged([9500, ...earlier], fields), TODAY)

const RISE = { kind: 'changed', charge: { date: LATEST, amountCents: 9500 } }

describe('billChangeOf for a bill whose amount varies', () => {
  it('stays quiet for a bill whose cycles keep moving, however it was added', () => {
    // Power added by hand, so not marked as varying: $120, $85, $140, then $95.
    expect(riseAfter([14000, 8500, 12000], { amountCents: 12000 })).toBeNull()
    // Heating climbing into winter moves the same way each month, and still varies.
    expect(billChangeOf(charged([15000, 13000, 9000, 6000], { amountCents: 6000 }), TODAY)).toBe(
      null,
    )
    // Swinging between two amounts every cycle varies too, though each swing comes back.
    expect(billChangeOf(charged([4000, 8000, 4000, 8000, 4000, 8000]), TODAY)).toBeNull()
  })

  it('still alerts when a steady bill changes price, after an earlier change too', () => {
    // $80 for three months, then $95: one move is a price change, not a varying bill.
    expect(riseAfter([8000, 8000, 8000])).toMatchObject(RISE)
    // A second rise after the first settled at $95: still news.
    const again = charged([11000, 9500, 9500, 8000], { amountCents: 9500 })
    expect(billChangeOf(again, TODAY)).toMatchObject({
      kind: 'changed',
      charge: { amountCents: 11000 },
    })
  })

  it('leaves one odd cycle out, so a credit, a late fee or a double payment hides no rise', () => {
    // A $40 credit, a $95 late fee, a $160 double payment: each came straight back to $80.
    expect(riseAfter([8000, 4000, 8000, 8000, 8000])).toMatchObject(RISE)
    expect(riseAfter([8000, 9500, 8000, 8000, 8000])).toMatchObject(RISE)
    expect(riseAfter([8000, 16000, 8000, 8000])).toMatchObject(RISE)
    // A weekly bill with one odd week about nine weeks back.
    const weeks = [8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 4000, 8000, 8000]
    expect(riseAfter(weeks, { cadence: 'week' })).toMatchObject(RISE)
  })

  it('reads price steps with steady stretches between them as a steady bill', () => {
    // A promo ending in stages: $50, $50, $65, $65, $80, $80, then $95.
    expect(riseAfter([8000, 8000, 6500, 6500, 5000, 5000])).toMatchObject(RISE)
    // A prorated first month, then a one-off credit.
    expect(riseAfter([8000, 8000, 4000, 8000, 3700])).toMatchObject(RISE)
  })

  it('settles a new amount charged twice, even after an odd cycle', () => {
    const twice = charged([9500, 9500, 8000, 4000, 8000])
    expect(billChangeOf(twice, TODAY)).toMatchObject({ kind: 'settled', amountCents: 9500 })
  })

  it(`needs ${VARIES_AFTER_MOVES} moves, so three earlier cycles, to call a bill varying`, () => {
    // Two earlier cycles that moved can be a price change and its settling: judged as usual.
    expect(riseAfter([14000, 8500])).toMatchObject(RISE)
    // A third that moved again is a bill that varies.
    expect(riseAfter([14000, 8500, 12000])).toBeNull()
  })
})

describe('amountsVary', () => {
  it('counts moves past the threshold, needing at least two and most of the steps', () => {
    expect(amountsVary([14000, 8000])).toBe(false)
    expect(amountsVary([14000, 8000, 12000])).toBe(true)
    // Moves under the threshold are no moves.
    expect(amountsVary([8100, 8000, 8200])).toBe(false)
    // Two moves in four steps are not most of them.
    expect(amountsVary([9500, 9500, 8000, 8000, 6500])).toBe(false)
    expect(amountsVary([9500, 8000, 9500, 8000, 6500])).toBe(true)
  })

  it('leaves out only the first odd cycle that came straight back', () => {
    expect(amountsVary([8000, 16000, 8000, 8000])).toBe(false)
    // A second one is a pattern: $80, $160, $80, $40, $80 moves in most steps left.
    expect(amountsVary([8000, 16000, 8000, 4000, 8000])).toBe(true)
  })
})

describe('bill change alerts for a bill whose amount varies', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const { call } = actionCaller(() => ctx)

  beforeAll(async () => {
    ctx = await createTestContext()
  })
  afterAll(async () => {
    await ctx.db.end()
  })
  beforeEach(async () => {
    await resetData(ctx.db)
    ctx.setNow(new Date('2026-11-17T18:00:00Z'))
  })

  const changes = async () =>
    (await call('list_alerts', {})).filter((alert) => alert.kind === 'bill_change')

  /** A bill added on `trackedAt`, then charged each of `charges` from one account. */
  async function trackedBill(
    fields: { name: string; amountCents: number; trackedAt: string },
    charges: (readonly [string, number])[],
  ) {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    const bill = await call('create_bill', {
      name: fields.name,
      amountCents: fields.amountCents,
      cadence: 'month',
      anchorDate: LATEST,
      matchPattern: fields.name.toLowerCase(),
    })
    await ctx.db.query(`UPDATE bills SET created_at = $2 WHERE id = $1`, [
      bill.id,
      fields.trackedAt,
    ])
    for (const [date, amountCents] of charges) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: fields.name.toUpperCase(),
        amountCents,
      })
    }
    return bill.id
  }

  it('stays quiet for a utility bill added by hand whose amount swings', async () => {
    await trackedBill({ name: 'City Power', amountCents: 11000, trackedAt: '2026-07-25' }, [
      ['2026-08-18', 12000],
      ['2026-09-17', 8500],
      ['2026-10-19', 14000],
      ['2026-11-16', 9000],
    ])
    expect(await changes()).toEqual([])
  })

  it.each(['bank_text', 'shown_name'])(
    'reads a year of charges, reading %s, so a long steady history outweighs recent odd ones',
    async (reads) => {
      // Steady at $80 for seven months, then a $160 double payment and a $40
      // credit, then a $95 rise. The last six charges alone would look varying.
      const months = [9500, 8000, 4000, 8000, 16000, 8000, 8000, 8000, 8000, 8000, 8000, 8000]
      const billId = await trackedBill(
        { name: 'Comcast', amountCents: 8000, trackedAt: '2025-11-25' },
        months.map((amountCents, back) => [addDays(LATEST, -30 * back), amountCents] as const),
      )
      await ctx.db.query('UPDATE bills SET reads = $2 WHERE id = $1', [billId, reads])
      expect(await changes()).toMatchObject([
        { message: 'Comcast was $95, usually $80.', date: LATEST },
      ])
    },
  )
})
