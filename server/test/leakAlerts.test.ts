// Money leaks as account alerts (leaks/): a charge made twice and a price
// gone up, worded with no account number and read from stored charges.
// Notifying and hiding them is in leakNotify.test.ts, a tracked bill paid
// twice in leakBillPaidTwice.test.ts, and payments to people in
// leakPeople.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { duplicateAlert, priceRiseAlert } from '../src/domain/leaks/leakAlerts.js'
import { leakAlerts } from '../src/domain/leaks/leakSource.js'
import { actionCaller } from './actionCaller.js'
import {
  chargedTwice,
  everyday,
  isLeak,
  leakFormat as format,
  spotifyRose,
} from './fixtures/leaks.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'
import { withoutUuids } from './uuids.js'

const charge = (id: string, date: string, amountCents: number) => ({
  id,
  accountId: 'checking',
  date,
  name: 'NETFLIX.COM',
  merchantName: 'Netflix',
  amountCents,
})

describe('leak wording', () => {
  const names = { accountName: 'Everyday', merchant: 'Netflix' }

  it('says when a charge was made twice, on two days or one', () => {
    const twoDays = duplicateAlert(
      {
        accountId: 'checking',
        charges: [charge('a', '2026-11-03', 1549), charge('b', '2026-11-04', 1549)],
      },
      names,
      format,
    )
    expect(twoDays).toMatchObject({
      kind: 'duplicate_charge',
      severity: 'warning',
      amountCents: 1549,
      count: 2,
      date: '2026-11-04',
      message: 'Netflix charged $15.49 twice, on Nov 3 and Nov 4.',
      summary: 'Netflix charged $15.49 twice.',
      charge: { id: 'b', merchant: 'Netflix', previousCents: null },
    })
    const oneDay = duplicateAlert(
      {
        accountId: 'checking',
        charges: [charge('a', '2026-11-03', 1549), charge('b', '2026-11-03', 1549)],
      },
      names,
      format,
    )
    expect(oneDay.message).toBe('Netflix charged $15.49 twice on Nov 3.')
  })

  it('says how many times over a run of days', () => {
    const run = duplicateAlert(
      {
        accountId: 'checking',
        charges: [
          charge('a', '2026-11-03', 1000),
          charge('b', '2026-11-04', 1000),
          charge('c', '2026-11-05', 1000),
        ],
      },
      names,
      format,
    )
    expect(run.message).toBe('Netflix charged $10, 3 times between Nov 3 and Nov 5.')
    expect(run.summary).toBe('Netflix charged $10, 3 times.')
    expect(run.count).toBe(3)
  })

  it('says what a price went up to and from', () => {
    const alert = priceRiseAlert(
      { charge: charge('c', '2026-11-12', 1199), previousCents: 1099 },
      { accountName: 'Everyday', merchant: 'Spotify' },
      format,
    )
    expect(alert).toMatchObject({
      kind: 'price_rise',
      severity: 'warning',
      amountCents: 1199,
      message: 'Spotify went up to $11.99, from $10.99.',
      charge: { id: 'c', merchant: 'Spotify', previousCents: 1099 },
    })
  })

  it('leaves out a leak on an account not among those named', () => {
    const rise = { charge: charge('c', '2026-11-12', 1199), previousCents: 1099 }
    const duplicate = {
      accountId: 'checking',
      charges: [charge('a', '2026-11-03', 1549), charge('b', '2026-11-04', 1549)],
    }
    const found = { duplicates: [duplicate], rises: [rise], names: new Map() }
    expect(leakAlerts(found, new Map(), format)).toEqual([])
    const named = leakAlerts(found, new Map([['checking', 'Everyday']]), format)
    expect(named.map((alert) => alert.kind)).toEqual(['duplicate_charge', 'price_rise'])
  })

  it('names the merchant its names give the charge, and no one when they give none', () => {
    const rise = { charge: charge('c', '2026-11-12', 1199), previousCents: 1099 }
    const duplicate = {
      accountId: 'checking',
      charges: [charge('a', '2026-11-03', 1549), charge('b', '2026-11-04', 1549)],
    }
    const names = new Map([
      ['b', 'Netflix'],
      ['c', null],
    ])
    const found = { duplicates: [duplicate], rises: [rise], names }
    const alerts = leakAlerts(found, new Map([['checking', 'Everyday']]), format)
    expect(alerts.map((alert) => [alert.message, alert.charge?.merchant])).toEqual([
      ['Netflix charged $15.49 twice, on Nov 3 and Nov 4.', 'Netflix'],
      ['A repeating payment went up to $11.99, from $10.99.', null],
    ])
  })
})

describe('leak wording with no merchant named', () => {
  const nameless = { accountName: 'Everyday', merchant: null }
  const twice = (dates: string[]) =>
    duplicateAlert(
      {
        accountId: 'checking',
        charges: dates.map((date, index) => charge(`c${index}`, date, 4000)),
      },
      nameless,
      format,
    )

  it('says a payment went out twice on one day, or on two', () => {
    expect(twice(['2026-11-03', '2026-11-03'])).toMatchObject({
      message: 'A payment of $40 went out twice on Nov 3.',
      summary: 'A payment of $40 went out twice.',
      charge: { id: 'c1', merchant: null, previousCents: null },
    })
    expect(twice(['2026-11-03', '2026-11-04']).message).toBe(
      'A payment of $40 went out twice, on Nov 3 and Nov 4.',
    )
  })

  it('says how many times a payment went out over a run of days', () => {
    const run = twice(['2026-11-03', '2026-11-04', '2026-11-05'])
    expect(run.message).toBe('A payment of $40 went out 3 times between Nov 3 and Nov 5.')
    expect(run.summary).toBe('A payment of $40 went out 3 times.')
  })

  it('says a repeating payment went up, still pointing at its charge', () => {
    const alert = priceRiseAlert(
      { charge: charge('c', '2026-11-01', 165_000), previousCents: 150_000 },
      nameless,
      format,
    )
    expect(alert).toMatchObject({
      message: 'A repeating payment went up to $1,650, from $1,500.',
      summary: 'A repeating payment went up to $1,650, from $1,500.',
      charge: { id: 'c', merchant: null, previousCents: 150_000 },
    })
  })
})

describe('leak alerts', () => {
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

  const leaks = async () => (await call('list_alerts', {})).filter(isLeak)

  it('alerts for a charge made twice, with no account number anywhere', async () => {
    const { accountId } = await everyday(ctx.db)
    await chargedTwice(ctx.db, accountId)
    const [alert] = await leaks()
    expect(alert).toMatchObject({
      kind: 'duplicate_charge',
      accountId,
      accountName: 'Test Everyday',
      message: 'Netflix charged $15.49 twice, on Nov 3 and Nov 4.',
    })
    expect(withoutUuids(JSON.stringify(await leaks()))).not.toContain('4417')
  })

  it('never takes a pending line and its posted twin for a duplicate', async () => {
    const { accountId } = await everyday(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-15',
      name: 'TARGET',
      merchantName: 'Target',
      amountCents: 4210,
      pending: true,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-16',
      name: 'TARGET',
      merchantName: 'Target',
      amountCents: 4210,
    })
    expect(await leaks()).toEqual([])
  })

  it('leaves out moves between the owner’s own accounts and charges left out of totals', async () => {
    const { accountId } = await everyday(ctx.db)
    await chargedTwice(ctx.db, accountId)
    await ctx.db.query(`UPDATE transactions SET excluded = true`)
    expect(await leaks()).toEqual([])
    await ctx.db.query(`UPDATE transactions SET excluded = false`)
    const transfer = await ctx.db.query<{ id: string }>(
      `INSERT INTO categories (name, color, kind, position) VALUES ('Transfer', '#888888', 'transfer', 0)
       RETURNING id`,
    )
    await ctx.db.query(`UPDATE transactions SET category_id = $1`, [transfer.rows[0]!.id])
    expect(await leaks()).toEqual([])
  })

  it('leaves two overdraft fees on a day to the fee alert, never calling them a duplicate', async () => {
    const { accountId } = await everyday(ctx.db)
    for (let fee = 0; fee < 2; fee++) {
      await insertBankTransaction(ctx.db, accountId, {
        date: '2026-11-16',
        name: 'OVERDRAFT FEE',
        amountCents: 3_400,
      })
    }
    expect(await leaks()).toEqual([])
    const kinds = (await call('list_alerts', {})).map((alert) => alert.kind)
    expect(kinds).toContain('overdraft_fee')
  })

  it('never calls cash, checks or bank fees the owner was charged twice a duplicate', async () => {
    const { accountId } = await everyday(ctx.db)
    const twice = async (fields: { name: string; detailed?: string; amountCents?: number }) => {
      for (const date of ['2026-11-10', '2026-11-11']) {
        await insertBankTransaction(ctx.db, accountId, { amountCents: 6_000, date, ...fields })
      }
    }
    await twice({ name: 'ATM WITHDRAWAL', detailed: 'TRANSFER_OUT_WITHDRAWAL' })
    await twice({ name: 'NON-NETWORK ATM FEE', detailed: 'BANK_FEES_ATM_FEES', amountCents: 300 })
    await twice({ name: 'VENMO PAYMENT', detailed: 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS' })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-12',
      name: 'CHECK 1043',
      amountCents: 120_000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-13',
      name: 'CHECK 1044',
      amountCents: 120_000,
    })
    expect(await leaks()).toEqual([])
  })

  it('judges a habit from when the charges came, so it never turns into a late alert', async () => {
    const { accountId } = await everyday(ctx.db)
    // A $4.50 coffee every five days in late summer, then two on Nov 19.
    for (const date of [
      '2026-08-24',
      '2026-08-29',
      '2026-09-03',
      '2026-09-08',
      '2026-11-19',
      '2026-11-19',
    ]) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'CORNER CAFE',
        merchantName: 'Corner Cafe',
        amountCents: 450,
      })
    }
    for (const day of ['2026-11-20', '2026-11-25']) {
      ctx.setNow(new Date(`${day}T18:00:00Z`))
      expect(await leaks()).toEqual([])
    }
  })

  it('alerts for a price rise on a repeating charge that is not a bill', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    const [alert] = await leaks()
    expect(alert).toMatchObject({
      kind: 'price_rise',
      accountId,
      date: '2026-11-12',
      message: 'Spotify went up to $11.99, from $10.99.',
      charge: { merchant: 'Spotify', previousCents: 1099 },
    })
    expect(withoutUuids(JSON.stringify(alert))).not.toContain('4417')
  })

  it('leaves a tracked bill to its own change alert, so a rise is never said twice', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    await call('create_bill', {
      name: 'Spotify',
      amountCents: 1099,
      cadence: 'month',
      anchorDate: '2026-11-12',
      matchPattern: 'spotify',
    })
    expect(await leaks()).toEqual([])
  })

  it('leaves a bill whose pattern is from the bank’s description to its own alert too', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    // The bank names the merchant "Spotify"; only its description says "SPOTIFY USA".
    await call('create_bill', {
      name: 'Spotify',
      amountCents: 1099,
      cadence: 'month',
      anchorDate: '2026-11-12',
      matchPattern: 'Spotify USA',
    })
    expect(await leaks()).toEqual([])
  })

  it('points a rise at the same charge every time on a day paid in parts', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    await ctx.db.query(`DELETE FROM transactions WHERE date = '2026-11-12'`)
    const ids: string[] = []
    for (const amountCents of [600, 599]) {
      ids.push(
        await insertBankTransaction(ctx.db, accountId, {
          date: '2026-11-12',
          name: 'SPOTIFY USA 4417',
          merchantName: 'Spotify',
          amountCents,
        }),
      )
    }
    const [rise] = await leaks()
    // The day's charges are read in id order, and the last stands for the day.
    expect(rise!.charge!.id).toBe(ids.sort().at(-1))
  })

  it('tells a subscription no bill tracks, charged twice on its day, only as charged twice', async () => {
    const { accountId } = await everyday(ctx.db)
    // Netflix at $15.49 on the 3rd since July, and a second $15.49 on Nov 3.
    for (const date of ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'NETFLIX.COM 4417',
        merchantName: 'Netflix',
        amountCents: 1549,
      })
    }
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-03',
      name: 'NETFLIX.COM 4417',
      merchantName: 'Netflix',
      amountCents: 1549,
    })
    expect((await leaks()).map((alert) => alert.message)).toEqual([
      'Netflix charged $15.49 twice on Nov 3.',
    ])
  })

  it('still says a rise on a charge the owner chose not to track', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    const [series] = await call('find_recurring')
    await call('dismiss_recurring', { key: series!.key })
    expect((await leaks()).map((alert) => alert.kind)).toEqual(['price_rise'])
  })

  it('leaves out leaks on an account the bank no longer shares, and on other accounts picked', async () => {
    const { accountId } = await everyday(ctx.db)
    const other = await insertBankAccount(ctx.db, { name: 'Other' })
    await chargedTwice(ctx.db, accountId)
    const picked = await call('list_alerts', { accountIds: [other.accountId] })
    expect(picked.filter((alert) => alert.kind === 'duplicate_charge')).toEqual([])
    await ctx.db.query(`UPDATE accounts SET unshared_at = now() WHERE id = $1`, [accountId])
    expect(await leaks()).toEqual([])
  })
})
