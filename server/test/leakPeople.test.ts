// Leaks are about what a merchant charges. Money the owner sends a person,
// takes out as cash, writes a check for, wires or pays through the bank's bill
// pay repeats too, but its amount is the owner's choice, and a payment to a
// person is named after that person. None of it is ever a leak: no price
// rise and no charge made twice. How a leak a merchant may have made is
// named is in leakNaming.test.ts, and every output in leakPeopleEverywhere.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { repeatingCharges } from '../src/domain/leaks/leakSource.js'
import { untrackedSeries } from '../src/domain/untrackedRecurring.js'
import { actionCaller } from './actionCaller.js'
import {
  leaksOf,
  MONTHS,
  NOT_MERCHANTS,
  repeat,
  SENT_TO_JANE,
  SPOTIFY,
  twiceOnNov3,
  ZELLE_TO_JANE,
} from './fixtures/leakPeople.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

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

const leaks = async () => leaksOf(await call('list_alerts', {}))

const priceRises = async () => (await leaks()).filter((alert) => alert.kind === 'price_rise')

const everyday = async () => (await insertBankAccount(ctx.db, { name: 'Everyday' })).accountId

describe('repeating lines a merchant did not charge', () => {
  it('are found as repeating, yet only the merchant is read for a price rise', async () => {
    const accountId = await everyday()
    for (const line of [...NOT_MERCHANTS, SPOTIFY]) await repeat(ctx.db, accountId, line)

    // Detection still finds them (so they can be tracked as bills), which is
    // what makes this a real test of the rise check rather than of detection.
    const found = await untrackedSeries(ctx.db, '2026-11-17')
    // Some probes share a merchant key, so the lines are counted, not the series.
    const lines = found.flatMap((one) => one.charges).length
    expect(lines).toBe((NOT_MERCHANTS.length + 1) * MONTHS.length)
    const merchants = repeatingCharges(found).map((one) => one.charges[0]!.merchantName)
    expect(merchants).toEqual(['Spotify'])
  })

  it('never raise a price rise: the reviewer’s Zelle probe included', async () => {
    await repeat(ctx.db, await everyday(), ZELLE_TO_JANE)
    expect(await priceRises()).toEqual([])
  })

  it.each(NOT_MERCHANTS.map((line) => [line.name, line] as const))(
    'raise none for %s',
    async (_name, line) => {
      await repeat(ctx.db, await everyday(), line)
      expect(await priceRises()).toEqual([])
    },
  )

  it.each(SENT_TO_JANE.map((line) => [line.name, line.detailed ?? 'no code', line] as const))(
    'raise no charge made twice for %s (%s), $40 twice in one day',
    async (_name, _code, line) => {
      await twiceOnNov3(ctx.db, await everyday(), line)
      expect(await leaks()).toEqual([])
    },
  )

  it('leave out a whole series when any of its lines is a payment to a person', async () => {
    await repeat(ctx.db, await everyday(), SPOTIFY)
    // The bank coded one month's line as sent through an app: the series is not a price.
    await ctx.db.query(
      `UPDATE transactions SET provider_category_detailed = 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'
       WHERE date = '2026-09-01'`,
    )
    expect(await priceRises()).toEqual([])
  })
})
