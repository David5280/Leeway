// Following a varying bill's amount (billChanges.ts) without ever taking the
// wrong figure: a cycle paid twice by mistake is read paid once, and an
// amount the owner sets stands until a cycle posts after they set it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { billChangeOf, type WatchedBill } from '../src/domain/billChanges.js'
import { settleBillChanges } from '../src/domain/billChangeSource.js'
import type { BillCharge } from '../src/domain/billCycles.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const TODAY = '2026-11-17'

/** A charge on the checking account. */
const paid = (date: string, amountCents: number): BillCharge => ({
  accountId: 'checking',
  date,
  amountCents,
})

/** City Power, tracked long ago at $110 and flagged as varying, charged `charges` (newest first). */
const cityPower = (charges: BillCharge[], fields: Partial<WatchedBill> = {}): WatchedBill => ({
  id: 'bill-1',
  name: 'City Power',
  amountCents: 11000,
  cadence: 'month',
  trackedOn: '2025-01-01',
  amountVaries: true,
  amountSetOn: null,
  charges,
  ...fields,
})

/** $130, $90, $140 and $100 from July to October, newest first. */
const SWINGS = [
  paid('2026-10-16', 13000),
  paid('2026-09-16', 9000),
  paid('2026-08-17', 14000),
  paid('2026-07-16', 10000),
]

describe('billChangeOf following a varying bill paid twice in a cycle', () => {
  it('reads the latest cycle paid once, so autopay and a manual payment never double it', () => {
    const twice = cityPower([paid('2026-11-16', 11000), paid('2026-11-15', 11000), ...SWINGS])
    // $110, $130 and $90 average $110: already the usual amount, so nothing to settle.
    expect(billChangeOf(twice, TODAY)).toBeNull()
    // From $95 it settles at $110, not at the $220 the two charges add up to.
    const lower = { ...twice, amountCents: 9500 }
    expect(billChangeOf(lower, TODAY)).toMatchObject({ kind: 'settled', amountCents: 11000 })
  })

  it('reads the cycles before the latest paid once too, so a doubled one never lifts the average', () => {
    const doubledEarlier = cityPower([
      paid('2026-11-16', 9000),
      paid('2026-10-17', 13000),
      paid('2026-10-16', 13000),
      ...SWINGS.slice(1),
    ])
    // $90, $130 and $90 average $103.33; counting both $130 charges would make it $146.67.
    expect(billChangeOf(doubledEarlier, TODAY)).toMatchObject({
      kind: 'settled',
      amountCents: 10333,
    })
  })

  it('still adds up a cycle paid in two different parts', () => {
    // $60 and $50 a week apart are one $110 cycle paid in parts, not a repeat.
    const split = cityPower([paid('2026-11-16', 6000), paid('2026-11-09', 5000), ...SWINGS], {
      amountCents: 9500,
    })
    expect(billChangeOf(split, TODAY)).toMatchObject({ kind: 'settled', amountCents: 11000 })
  })

  it('keeps raw totals for a steady bill, so a doubled cycle shows as changed', () => {
    const steady = cityPower(
      [
        paid('2026-11-16', 11000),
        paid('2026-11-15', 11000),
        paid('2026-10-16', 11000),
        paid('2026-09-16', 11000),
      ],
      { amountVaries: false },
    )
    expect(billChangeOf(steady, TODAY)).toMatchObject({
      kind: 'changed',
      charge: { amountCents: 22000 },
    })
  })
})

describe('billChangeOf after the owner set the amount', () => {
  // $90, $140 and $85 from September: following them settles at $105.
  const recent = [paid('2026-11-16', 9000), paid('2026-10-16', 14000), paid('2026-09-16', 8500)]

  /** The bill charged `charges`, its amount set to $200 by the owner on `setOn`. */
  const setByOwner = (charges: BillCharge[], setOn: string, fields: Partial<WatchedBill> = {}) =>
    billChangeOf(cityPower(charges, { amountCents: 20000, amountSetOn: setOn, ...fields }), TODAY)

  it('settles nothing from a cycle that posted before or on the day the owner set it', () => {
    expect(setByOwner(recent, '2026-11-17')).toBeNull()
    // Set the same day the charge posted: it may have come first, so the owner's figure stands.
    expect(setByOwner(recent, '2026-11-16')).toBeNull()
  })

  it('follows again from a cycle whose charges all posted after the owner set it', () => {
    expect(setByOwner(recent, '2026-11-10')).toMatchObject({ kind: 'settled', amountCents: 10500 })
    // A cycle paid in parts, one part before the edit, is not wholly after it.
    const parts = [paid('2026-11-16', 4000), paid('2026-11-08', 5000), ...recent.slice(1)]
    expect(setByOwner(parts, '2026-11-10')).toBeNull()
  })

  it('leaves a steady bill at the amount the owner set until a cycle comes after it', () => {
    // $80 charged twice in a row would settle the owner's $200 back at $80.
    const steady = [paid('2026-11-16', 8000), paid('2026-10-16', 8000), paid('2026-09-16', 8000)]
    const notVarying = { amountVaries: false }
    expect(setByOwner(steady, '2026-11-16', notVarying)).toBeNull()
    expect(setByOwner(steady, '2026-11-01', notVarying)).toMatchObject({
      kind: 'settled',
      amountCents: 8000,
    })
  })
})

describe('following a varying bill, end to end', () => {
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

  /** City Power added by hand at $110 in June, with autopay, then charged each of `charges`. */
  async function cityPowerCharged(charges: (readonly [string, number])[]) {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    const bill = await call('create_bill', {
      name: 'City Power',
      amountCents: 11000,
      cadence: 'month',
      anchorDate: '2026-11-20',
      matchPattern: 'city power',
      autopay: true,
    })
    await ctx.db.query(`UPDATE bills SET created_at = '2026-06-25' WHERE id = $1`, [bill.id])
    await addCharges(accountId, charges)
    return { billId: bill.id, accountId }
  }

  async function addCharges(accountId: string, charges: (readonly [string, number])[]) {
    for (const [date, amountCents] of charges) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'CITY POWER 4417',
        merchantName: 'City Power',
        amountCents,
      })
    }
  }

  const usual = async (billId: string) =>
    (await call('list_bills')).bills.find((bill) => bill.id === billId)!.amountCents

  const amountSetAt = async (billId: string) => {
    const { rows } = await ctx.db.query<{ amount_set_at: Date | null }>(
      'SELECT amount_set_at FROM bills WHERE id = $1',
      [billId],
    )
    return rows[0]!.amount_set_at
  }

  const alertKinds = async () => (await call('list_alerts', {})).map((alert) => alert.kind)

  /** $100, $140, $90 and $130 from July to October: a bill that varies by its own history. */
  const SWUNG = [
    ['2026-07-16', 10000],
    ['2026-08-17', 14000],
    ['2026-09-16', 9000],
    ['2026-10-16', 13000],
  ] as const

  it('keeps a bill paid twice in its latest cycle at the single amount, the probe that doubled', async () => {
    // Autopay took $110 on Nov 15, and a manual payment of $110 went through on Nov 16.
    const { billId } = await cityPowerCharged([
      ...SWUNG,
      ['2026-11-15', 11000],
      ['2026-11-16', 11000],
    ])
    await refreshInbox(ctx)
    // $110, $130 and $90 average $110, where the doubled cycle read $220.
    expect(await usual(billId)).toBe(11000)
    // "Charged twice?" still tells the extra charge, and no bill change says it again.
    const kinds = await alertKinds()
    expect(kinds).toContain('duplicate_charge')
    expect(kinds).not.toContain('bill_change')
  })

  it('keeps an amount the owner sets through a refresh, with no message', async () => {
    const { billId } = await cityPowerCharged([...SWUNG, ['2026-11-16', 9000]])
    await refreshInbox(ctx)
    // $90, $130 and $90 average $103.33.
    expect(await usual(billId)).toBe(10333)
    await call('update_bill', { id: billId, amountCents: 20000 })
    await refreshInbox(ctx)
    expect(await usual(billId)).toBe(20000)
    expect(await alertKinds()).not.toContain('bill_change')
  })

  it('follows again from the next cycle that posts after the owner set the amount', async () => {
    const { billId, accountId } = await cityPowerCharged([...SWUNG, ['2026-11-16', 9000]])
    await call('update_bill', { id: billId, amountCents: 20000 })
    ctx.setNow(new Date('2026-12-17T18:00:00Z'))
    await addCharges(accountId, [['2026-12-16', 15000]])
    await refreshInbox(ctx)
    // $150, $90 and $130 average $123.33, under the latest $150.
    expect(await usual(billId)).toBe(15000)
  })

  it("never counts Leeway's own writes, or a save that keeps the amount, as the owner's", async () => {
    const { billId, accountId } = await cityPowerCharged([...SWUNG, ['2026-11-16', 9000]])
    expect(await settleBillChanges(ctx.db, 'UTC', TODAY)).toBe(1)
    // Renaming it resends the settled amount, as the form does: no new figure.
    await call('update_bill', { id: billId, name: 'Home power', amountCents: 10333 })
    expect(await amountSetAt(billId)).toBeNull()

    // So a cheaper December moves it on, since no owner edit holds it.
    ctx.setNow(new Date('2026-12-17T18:00:00Z'))
    await addCharges(accountId, [['2026-12-16', 6000]])
    await refreshInbox(ctx)
    // $60, $90 and $130 average $93.33.
    expect(await usual(billId)).toBe(9333)
    expect(await amountSetAt(billId)).toBeNull()
  })

  it('records the time the owner set the amount, from the app clock', async () => {
    const { billId } = await cityPowerCharged([])
    await call('update_bill', { id: billId, amountCents: 12000 })
    expect(await amountSetAt(billId)).toEqual(new Date('2026-11-17T18:00:00Z'))
  })
})
