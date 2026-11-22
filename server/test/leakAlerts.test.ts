// Money leaks as account alerts (leaks/): a charge made twice and a price
// gone up, read from stored charges, worded with no account number, and
// shown, notified, hidden and dismissed like the other account alerts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { duplicateAlert, priceRiseAlert } from '../src/domain/leaks/leakAlerts.js'
import { leakAlerts } from '../src/domain/leaks/leakSource.js'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { accountAlertSubject } from '../src/domain/notifications/words.js'
import { formatCents } from '../src/lib/money.js'
import { shortDate } from '../src/lib/words.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const format = {
  money: (cents: number) => formatCents(cents),
  date: (date: string) => shortDate(date, 'en-US'),
}

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
      { name: 'Spotify', charge: charge('c', '2026-11-12', 1199), previousCents: 1099 },
      'Everyday',
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
    const rise = { name: 'Spotify', charge: charge('c', '2026-11-12', 1199), previousCents: 1099 }
    const duplicate = {
      accountId: 'checking',
      charges: [charge('a', '2026-11-03', 1549), charge('b', '2026-11-04', 1549)],
    }
    const found = { duplicates: [duplicate], rises: [rise], masks: [] }
    expect(leakAlerts(found, new Map(), format)).toEqual([])
    const named = leakAlerts(found, new Map([['checking', 'Everyday']]), format)
    expect(named.map((alert) => alert.kind)).toEqual(['duplicate_charge', 'price_rise'])
  })

  it('keys each leak by its charge, so the same charge is news once', () => {
    const alert = {
      kind: 'price_rise' as const,
      accountId: 'x',
      date: '2026-11-12',
      charge: { id: 'c', merchant: 'S', previousCents: 1 },
    }
    expect(accountAlertSubject(alert)).toBe('charge:c')
  })
})

describe('leak alerts', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const { call, callError } = actionCaller(() => ctx)

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

  /** An account whose number ends 4417, which the bank also writes in its text. */
  const everyday = () => insertBankAccount(ctx.db, { name: 'Everyday', mask: '4417' })

  const leaks = async () =>
    (await call('list_alerts', {})).filter(
      (alert) => alert.kind === 'duplicate_charge' || alert.kind === 'price_rise',
    )

  /** Netflix charged twice on Nov 3 and 4, as the bank wrote it. */
  async function chargedTwice(accountId: string) {
    for (const date of ['2026-11-03', '2026-11-04']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'NETFLIX.COM 4417',
        merchantName: 'Netflix',
        amountCents: 1549,
      })
    }
  }

  /** Spotify at $10.99 for two months, then $11.99, on a monthly schedule. */
  async function spotifyRose(accountId: string) {
    for (const [date, amountCents] of [
      ['2026-08-12', 1099],
      ['2026-09-12', 1099],
      ['2026-10-12', 1099],
      ['2026-11-12', 1199],
    ] as const) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'SPOTIFY USA 4417',
        merchantName: 'Spotify',
        amountCents,
      })
    }
  }

  it('alerts for a charge made twice, with no account number anywhere', async () => {
    const { accountId } = await everyday()
    await chargedTwice(accountId)
    const [alert] = await leaks()
    expect(alert).toMatchObject({
      kind: 'duplicate_charge',
      accountId,
      accountName: 'Test Everyday',
      message: 'Netflix charged $15.49 twice, on Nov 3 and Nov 4.',
    })
    expect(JSON.stringify(await leaks())).not.toContain('4417')
  })

  it('never takes a pending line and its posted twin for a duplicate', async () => {
    const { accountId } = await everyday()
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
    const { accountId } = await everyday()
    await chargedTwice(accountId)
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
    const { accountId } = await everyday()
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
    const { accountId } = await everyday()
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
    const { accountId } = await everyday()
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
    const { accountId } = await everyday()
    await spotifyRose(accountId)
    const [alert] = await leaks()
    expect(alert).toMatchObject({
      kind: 'price_rise',
      accountId,
      date: '2026-11-12',
      message: 'Spotify went up to $11.99, from $10.99.',
      charge: { merchant: 'Spotify', previousCents: 1099 },
    })
    expect(JSON.stringify(alert)).not.toContain('4417')
  })

  it('leaves a tracked bill to its own change alert, so a rise is never said twice', async () => {
    const { accountId } = await everyday()
    await spotifyRose(accountId)
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
    const { accountId } = await everyday()
    await spotifyRose(accountId)
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
    const { accountId } = await everyday()
    await spotifyRose(accountId)
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

  it('still says a rise on a charge the owner chose not to track', async () => {
    const { accountId } = await everyday()
    await spotifyRose(accountId)
    const [series] = await call('find_recurring')
    await call('dismiss_recurring', { key: series!.key })
    expect((await leaks()).map((alert) => alert.kind)).toEqual(['price_rise'])
  })

  it('leaves out leaks on an account the bank no longer shares, and on other accounts picked', async () => {
    const { accountId } = await everyday()
    const other = await insertBankAccount(ctx.db, { name: 'Other' })
    await chargedTwice(accountId)
    const picked = await call('list_alerts', { accountIds: [other.accountId] })
    expect(picked.filter((alert) => alert.kind === 'duplicate_charge')).toEqual([])
    await ctx.db.query(`UPDATE accounts SET unshared_at = now() WHERE id = $1`, [accountId])
    expect(await leaks()).toEqual([])
  })

  it('notifies once with nothing from the bank on a locked screen, and hides from home for good', async () => {
    const { accountId } = await everyday()
    await chargedTwice(accountId)
    await refreshInbox(ctx)
    await refreshInbox(ctx)
    const { rows } = await ctx.db.query<{ title: string; push_body: string; message: string }>(
      `SELECT title, message, push_body FROM notifications WHERE kind = 'duplicate_charge'`,
    )
    expect(rows).toEqual([
      {
        title: 'Charged twice?',
        message: 'Netflix charged $15.49 twice, on Nov 3 and Nov 4.',
        push_body: 'A charge may have gone through twice.',
      },
    ])

    const [alert] = await leaks()
    await call('hide_home_alert', {
      kind: 'duplicate_charge',
      accountId,
      chargeId: alert!.charge!.id,
    })
    expect((await call('list_home_alerts')).alerts).toEqual([])
    // A day on, a leak stays hidden: it is news, not a condition.
    ctx.setNow(new Date('2026-11-19T18:00:00Z'))
    expect((await call('list_home_alerts')).alerts).toEqual([])
  })

  it('needs the charge to hide a leak, so the wrong one is never hidden', async () => {
    const { accountId } = await everyday()
    await chargedTwice(accountId)
    const error = await callError('hide_home_alert', { kind: 'duplicate_charge', accountId })
    expect(error.code).toBe('invalid_input')
    expect((await call('list_home_alerts')).alerts.map((alert) => alert.kind)).toEqual([
      'duplicate_charge',
    ])
  })

  it('hides one leak without hiding another on the same account', async () => {
    const { accountId } = await everyday()
    await chargedTwice(accountId)
    await spotifyRose(accountId)
    const rise = (await leaks()).find((alert) => alert.kind === 'price_rise')!
    await call('hide_home_alert', { kind: 'price_rise', accountId, chargeId: rise.charge!.id })
    expect((await call('list_home_alerts')).alerts.map((alert) => alert.kind)).toEqual([
      'duplicate_charge',
    ])
  })

  it('names the push words of a price rise with no merchant', async () => {
    const { accountId } = await everyday()
    await spotifyRose(accountId)
    await refreshInbox(ctx)
    const { rows } = await ctx.db.query<{ title: string; push_body: string }>(
      `SELECT title, push_body FROM notifications WHERE kind = 'price_rise'`,
    )
    expect(rows).toEqual([
      { title: 'Price went up', push_body: 'A repeating charge went up in price.' },
    ])
  })

  describe('a tracked bill paid twice', () => {
    /** A $15.49 Netflix bill, tracked since September, paid twice this month. */
    async function billPaidTwice() {
      const { accountId } = await everyday()
      for (const date of ['2026-08-03', '2026-09-03', '2026-10-03']) {
        await insertBankTransaction(ctx.db, accountId, {
          date,
          name: 'NETFLIX.COM 4417',
          merchantName: 'Netflix',
          amountCents: 1549,
        })
      }
      await chargedTwice(accountId)
      await call('create_bill', {
        name: 'Netflix',
        amountCents: 1549,
        cadence: 'month',
        anchorDate: '2026-11-03',
        matchPattern: 'netflix',
      })
      await ctx.db.query(`UPDATE bills SET created_at = '2026-09-01T12:00:00Z'`)
      return accountId
    }

    it('is told once, as a charge made twice, not also as a bill change', async () => {
      await billPaidTwice()
      const kinds = (await call('list_alerts', {})).map((alert) => alert.kind)
      expect(kinds).toContain('duplicate_charge')
      expect(kinds).not.toContain('bill_change')
    })

    it('notifies once', async () => {
      await billPaidTwice()
      await refreshInbox(ctx)
      const { rows } = await ctx.db.query<{ kind: string }>(
        `SELECT kind FROM notifications WHERE kind IN ('duplicate_charge', 'bill_change')`,
      )
      expect(rows).toEqual([{ kind: 'duplicate_charge' }])
    })

    it('stays told once after a refund, and once the charge is old news', async () => {
      const accountId = await billPaidTwice()
      await insertBankTransaction(ctx.db, accountId, {
        date: '2026-11-08',
        name: 'NETFLIX.COM 4417',
        merchantName: 'Netflix',
        amountCents: -1549,
      })
      expect(await call('list_alerts', {})).toEqual([])
      ctx.setNow(new Date('2026-12-02T18:00:00Z'))
      expect(
        (await call('list_alerts', {})).filter((alert) => alert.kind === 'bill_change'),
      ).toEqual([])
    })
  })
})
