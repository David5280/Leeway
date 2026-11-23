// A bill whose amount varies by nature, like power or water, told by its own
// charges (amountsVary in billChanges.ts): it raises no "bill changed" alert,
// while a steady bill's price change still does, even after a one-off credit,
// late fee or double payment. Its usual amount follows its recent cycles
// instead (varyingUsualCents), so the cash flow and idle cash never reserve a
// stale figure.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  amountsVary,
  billChangeOf,
  VARIES_AFTER_MOVES,
  type BillChange,
  type WatchedBill,
} from '../src/domain/billChanges.js'
import { varyingUsualCents } from '../src/domain/varyingBills.js'
import { settleBillChanges } from '../src/domain/billChangeSource.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
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
    amountSetOn: null,
    followAfterOn: null,
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

/** Whether a change would reach the owner: only a 'changed' one raises an alert. */
const alerts = (change: BillChange | null) => change?.kind === 'changed'

describe('billChangeOf for a bill whose amount varies', () => {
  it('raises no alert for a bill whose cycles keep moving, however it was added', () => {
    // Power added by hand, so not marked as varying: $120, $85, $140, then $95.
    expect(alerts(riseAfter([14000, 8500, 12000], { amountCents: 12000 }))).toBe(false)
    // Heating climbing into winter moves the same way each month, and still varies.
    const heating = charged([15000, 13000, 9000, 6000], { amountCents: 6000 })
    expect(alerts(billChangeOf(heating, TODAY))).toBe(false)
    // Swinging between two amounts every cycle varies too, though each swing comes back.
    expect(alerts(billChangeOf(charged([4000, 8000, 4000, 8000, 4000, 8000]), TODAY))).toBe(false)
  })

  it("never takes a utility's jitter for a one-off, since a steady bill repeats to the cent", () => {
    // Water: $60, $45, $62, $58, $44, $61, then $75. $60 and $62 are near, not the same.
    const water = charged([7500, 6000, 4500, 6200, 5800, 4400, 6100], { amountCents: 6000 })
    expect(alerts(billChangeOf(water, TODAY))).toBe(false)
    // Power: $120, $85, $118, then $90; and the same with $90, then $135.
    const power = { amountCents: 12000 }
    expect(alerts(billChangeOf(charged([9000, 12000, 8500, 11800], power), TODAY))).toBe(false)
    const higher = charged([13500, 9000, 12000, 8500, 11800], power)
    expect(alerts(billChangeOf(higher, TODAY))).toBe(false)
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
    // One deeper in a steady history.
    expect(riseAfter([8000, 8000, 8000, 4000, 8000])).toMatchObject(RISE)
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

  it('raises no alert by design where a short history cannot tell a steady bill from a varying one', () => {
    // Two one-offs within five earlier cycles: $80, $40, $80, $160, $80, then $95.
    expect(alerts(riseAfter([8000, 16000, 8000, 4000, 8000]))).toBe(false)
    // A one-off at a price step in a short history: $80, $40, $95, then $110.
    const stepped = { amountCents: 9500 }
    expect(alerts(billChangeOf(charged([11000, 9500, 4000, 8000], stepped), TODAY))).toBe(false)
    // Price steps in consecutive months: $65, $80, $95, $95, then $110.
    const steps = charged([11000, 9500, 9500, 8000, 6500], stepped)
    expect(alerts(billChangeOf(steps, TODAY))).toBe(false)
  })

  it(`needs ${VARIES_AFTER_MOVES} moves, so three earlier cycles, to call a bill varying`, () => {
    // Two earlier cycles that moved can be a price change and its settling: judged as usual.
    expect(riseAfter([14000, 8500])).toMatchObject(RISE)
    // A third that moved again is a bill that varies.
    expect(alerts(riseAfter([14000, 8500, 12000]))).toBe(false)
  })
})

describe('billChangeOf following a varying bill', () => {
  it('settles a bill climbing into winter at its latest cycle, the probe that went stale', () => {
    // Heating tracked at $60, then $60, $90, $130, $175 and $180 from June to October.
    const heating = charged([18000, 17500, 13000, 9000, 6000], { amountCents: 6000 })
    expect(billChangeOf(heating, TODAY)).toMatchObject({ kind: 'settled', amountCents: 18000 })
  })

  it('settles at the recent average after a cheap month, so one dip never drops the reserve', () => {
    // $180, $175, then $90: the average of the three, $148.33, not $90.
    const dipped = charged([9000, 17500, 18000], { amountCents: 18000, amountVaries: true })
    expect(billChangeOf(dipped, TODAY)).toMatchObject({ kind: 'settled', amountCents: 14833 })
  })

  it('follows a bill flagged as varying from its first charge since tracking on', () => {
    const flagged = { amountVaries: true, trackedOn: '2026-10-25' }
    // One charge since tracking, and none before it: that charge is all there is to go by.
    expect(billChangeOf(charged([12000], flagged), TODAY)).toMatchObject({
      kind: 'settled',
      amountCents: 12000,
    })
    // Tracked after its latest charge: the figure the owner gave stands until a new one posts.
    expect(billChangeOf(charged([12000], { ...flagged, trackedOn: LATEST }), TODAY)).toBeNull()
  })

  it('reads only the cycles since a missed one, so a paused season is left out', () => {
    // $100 in November and $200 in October, after nothing since a $300 charge in June.
    const paused = {
      id: 'bill-1',
      name: 'Heating',
      amountCents: 5000,
      cadence: 'month' as const,
      trackedOn: '2025-01-01',
      amountVaries: true,
      amountSetOn: null,
      followAfterOn: null,
      charges: [
        { accountId: 'checking', date: LATEST, amountCents: 10000 },
        { accountId: 'checking', date: '2026-10-17', amountCents: 20000 },
        { accountId: 'checking', date: '2026-06-16', amountCents: 30000 },
      ],
    }
    expect(billChangeOf(paused, TODAY)).toMatchObject({ kind: 'settled', amountCents: 15000 })
  })

  it('settles nothing once the usual amount already follows, or with no recent charge', () => {
    const followed = charged([18000, 17500, 13000], { amountCents: 18000, amountVaries: true })
    expect(billChangeOf(followed, TODAY)).toBeNull()
    // Nothing for over a cycle and a half: the bill may have stopped, so its figure stands.
    expect(billChangeOf({ ...followed, amountCents: 6000 }, '2027-01-10')).toBeNull()
  })
})

describe('varyingUsualCents', () => {
  it('takes the higher of the latest cycle and the average with the cycles before it', () => {
    expect(varyingUsualCents(18000, [17500, 13000])).toBe(18000)
    expect(varyingUsualCents(9000, [17500, 18000])).toBe(14833)
    expect(varyingUsualCents(12000, [])).toBe(12000)
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

  const usual = async (billId: string) =>
    (await call('list_bills')).bills.find((bill) => bill.id === billId)!.amountCents

  it('stays quiet for a utility bill added by hand whose amount swings, and follows it', async () => {
    const billId = await trackedBill(
      { name: 'City Power', amountCents: 11000, trackedAt: '2026-07-25' },
      [
        ['2026-08-18', 12000],
        ['2026-09-17', 8500],
        ['2026-10-19', 14000],
        ['2026-11-16', 9000],
      ],
    )
    expect(await changes()).toEqual([])
    // $90, $140 and $85 average $105, above the latest $90.
    await refreshInbox(ctx)
    expect(await usual(billId)).toBe(10500)
    expect(await changes()).toEqual([])
  })

  it('keeps a heating bill climbing into winter current for the cash flow and idle cash', async () => {
    // Tracked at $60 in May, then charged $60, $90, $130, $175 and $180 from June to October.
    const billId = await trackedBill(
      { name: 'Heating', amountCents: 6000, trackedAt: '2026-05-20' },
      [
        ['2026-06-16', 6000],
        ['2026-07-16', 9000],
        ['2026-08-17', 13000],
        ['2026-09-16', 17500],
        ['2026-10-16', 18000],
      ],
    )
    await ctx.db.query('UPDATE bills SET anchor_date = $2 WHERE id = $1', [billId, '2026-11-20'])
    expect(await settleBillChanges(ctx.db, 'UTC', '2026-11-17')).toBe(1)
    // Settled once: refreshing again writes nothing more.
    expect(await settleBillChanges(ctx.db, 'UTC', '2026-11-17')).toBe(0)
    expect(await usual(billId)).toBe(18000)
    expect(await changes()).toEqual([])

    // A paycheck every other Friday, so the bill on Nov 20 falls before payday, Nov 27.
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
    })
    expect((await call('get_cash_flow')).billsDue).toMatchObject([
      { name: 'Heating', dueDate: '2026-11-20', amountCents: 18000 },
    ])
    expect(await call('get_idle_cash')).toMatchObject({ billsCents: 18000 })
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
