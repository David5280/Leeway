// A varying bill paid twice in a cycle never settles at double
// (varyingBills.ts): a repeat on one account within a few days is read once,
// and any other two equal charges in a cycle that costs nearer double than
// usual hold the amount where it was. An even split, or a bill paid in even
// halves that climbs a little each cycle, still follows.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { billChangeOf } from '../src/domain/billChanges.js'
import { holdsEqualPair } from '../src/domain/billCycles.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { actionCaller } from './actionCaller.js'
import {
  addCharges,
  cityPower,
  cityPowerCharged,
  paid,
  SWINGS,
  SWUNG,
  TODAY,
  usualOf,
} from './fixtures/cityPower.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

describe('holdsEqualPair', () => {
  it('finds two charges of one amount in a cycle, however far apart and on whichever accounts', () => {
    expect(holdsEqualPair([paid('2026-11-15', 11000), paid('2026-11-10', 11000)])).toBe(true)
    expect(holdsEqualPair([paid('2026-11-15', 11000, 'card'), paid('2026-11-10', 11000)])).toBe(
      true,
    )
    expect(holdsEqualPair([paid('2026-11-15', 6000), paid('2026-11-10', 5000)])).toBe(false)
    expect(holdsEqualPair([paid('2026-11-15', 11000)])).toBe(false)
    expect(holdsEqualPair([])).toBe(false)
  })
})

describe('billChangeOf following a varying bill paid twice in a cycle', () => {
  it('reads a repeat on one account within a few days once, so autopay and a manual payment never double it', () => {
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

  it.each([
    ['from two accounts a day apart', paid('2026-11-16', 11000, 'card'), paid('2026-11-15', 11000)],
    [
      'from two accounts five days apart',
      paid('2026-11-15', 11000, 'card'),
      paid('2026-11-10', 11000),
    ],
    ['from one account five days apart', paid('2026-11-15', 11000), paid('2026-11-10', 11000)],
  ])('settles nothing from a cycle charged twice %s', (_, second, first) => {
    const twice = cityPower([second, first, ...SWINGS])
    // $220 is nearer double the $110 average of the cycles before: the amount stays at $110.
    expect(billChangeOf(twice, TODAY)).toBeNull()
    expect(billChangeOf({ ...twice, amountCents: 9500 }, TODAY)).toBeNull()
  })

  it('leaves a cycle charged twice from two accounts out of a later average', () => {
    const later = cityPower([
      paid('2026-12-16', 10000),
      paid('2026-11-16', 11000, 'card'),
      paid('2026-11-15', 11000),
      ...SWINGS,
    ])
    // $100 and $130 average $115; the doubled $220 would make it $150.
    expect(billChangeOf(later, '2026-12-17')).toMatchObject({
      kind: 'settled',
      amountCents: 11500,
    })
  })

  it('still follows an even split across two accounts at the usual level', () => {
    // $55 from checking and $55 by card make the usual $110: a split, read whole.
    const split = cityPower(
      [paid('2026-11-16', 5500, 'card'), paid('2026-11-15', 5500), ...SWINGS],
      { amountCents: 9500 },
    )
    expect(billChangeOf(split, TODAY)).toMatchObject({ kind: 'settled', amountCents: 11000 })
  })

  it('still follows a bill paid in even halves that climbs each cycle', () => {
    // $85 + $85, $100 + $100, then $115 + $115: each cycle well under double the last.
    const halves = [11500, 10000, 8500].flatMap((half, back) => {
      const date = ['2026-11-16', '2026-10-16', '2026-09-16'][back]!
      return [paid(date, half, 'card'), paid(date, half)]
    })
    expect(billChangeOf(cityPower(halves, { amountCents: 17000 }), TODAY)).toMatchObject({
      kind: 'settled',
      amountCents: 23000,
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

describe('a varying bill paid twice, end to end', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const caller = actionCaller(() => ctx)

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

  const alertKinds = async () => (await caller.call('list_alerts', {})).map((alert) => alert.kind)

  it('keeps a bill paid twice in its latest cycle at the single amount, and says so once', async () => {
    // Autopay took $110 on Nov 15, and a manual payment of $110 went through on Nov 16.
    const charges = [...SWUNG, ['2026-11-15', 11000], ['2026-11-16', 11000]] as const
    const { billId } = await cityPowerCharged(ctx.db, caller, charges)
    await refreshInbox(ctx)
    // $110, $130 and $90 average $110, where the doubled cycle read $220.
    expect(await usualOf(caller, billId)).toBe(11000)
    // "Charged twice?" still tells the extra charge, and no bill change says it again.
    const kinds = await alertKinds()
    expect(kinds).toContain('duplicate_charge')
    expect(kinds).not.toContain('bill_change')
  })

  it.each([
    ['a day apart', '2026-11-15', '2026-11-16'],
    ['five days apart', '2026-11-10', '2026-11-15'],
  ])(
    'keeps a bill charged twice from two accounts %s at the single amount',
    async (_, firstDay, cardDay) => {
      const { billId } = await cityPowerCharged(ctx.db, caller, [...SWUNG, [firstDay, 11000]])
      const card = await insertBankAccount(ctx.db, { name: 'Card', type: 'credit' })
      await addCharges(ctx.db, card.accountId, [[cardDay, 11000]])
      await refreshInbox(ctx)
      expect(await usualOf(caller, billId)).toBe(11000)
    },
  )

  it('keeps a bill charged twice from one account five days apart at the single amount', async () => {
    const charges = [...SWUNG, ['2026-11-10', 11000], ['2026-11-15', 11000]] as const
    const { billId } = await cityPowerCharged(ctx.db, caller, charges)
    await refreshInbox(ctx)
    expect(await usualOf(caller, billId)).toBe(11000)
  })
})
