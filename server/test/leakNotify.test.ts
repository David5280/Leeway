// Money leaks in the inbox and on the home screen: each is notified once,
// with nothing from the bank on a locked screen, kept under a subject that
// holds no name, hidden one charge at a time, and read once per request.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { accountAlertSubject } from '../src/domain/notifications/words.js'
import { actionCaller } from './actionCaller.js'
import { chargedTwice, everyday, isLeak, spotifyRose } from './fixtures/leaks.js'
import { createTestContext, insertBankTransaction, resetData } from './helpers.js'

describe('a leak’s subject', () => {
  it('keys a charge made twice by its charge, so the same charge is news once', () => {
    const alert = {
      kind: 'duplicate_charge' as const,
      accountId: 'x',
      amountCents: 1549,
      date: '2026-11-04',
      charge: { id: 'c', merchant: 'Netflix', previousCents: null, previousId: null },
    }
    expect(accountAlertSubject(alert)).toBe('charge:c')
  })

  it('keys a price rise by its day and prices, never the charge standing for its day', () => {
    const alert = {
      kind: 'price_rise' as const,
      accountId: 'x',
      amountCents: 1199,
      date: '2026-11-12',
      charge: { id: 'c', merchant: 'Spotify', previousCents: 1099, previousId: 'p' },
    }
    expect(accountAlertSubject(alert)).toBe('rise:x:2026-11-12:p:1099:1199')
    const sameDayLater = { ...alert, charge: { ...alert.charge, id: 'later' } }
    expect(accountAlertSubject(sameDayLater)).toBe(accountAlertSubject(alert))
  })

  it('never puts the name in a price rise’s subject, so a person’s name is never stored', () => {
    const alert = {
      kind: 'price_rise' as const,
      accountId: 'x',
      amountCents: 165_000,
      date: '2026-11-01',
      charge: { id: 'c', merchant: 'Jane Doe', previousCents: 150_000, previousId: 'p' },
    }
    expect(accountAlertSubject(alert)).toBe('rise:x:2026-11-01:p:150000:165000')
    const unnamed = { ...alert, charge: { ...alert.charge, merchant: null } }
    expect(accountAlertSubject(unnamed)).toBe(accountAlertSubject(alert))
  })
})

describe('leaks in the inbox and on home', () => {
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const leaks = async () => (await call('list_alerts', {})).filter(isLeak)

  /**
   * Spotify's new price posts again on Nov 12, with an id that sorts before
   * the first one's, so it is the charge that now stands for the day.
   */
  async function postsAgainFirstInOrder(accountId: string) {
    const id = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-12',
      name: 'SPOTIFY USA 4417',
      merchantName: 'Spotify',
      amountCents: 1199,
    })
    await ctx.db.query(
      `UPDATE transactions SET id = '00000000-0000-4000-8000-000000000000' WHERE id = $1`,
      [id],
    )
  }

  /** The id of the one charge on this day. */
  async function chargeOn(date: string): Promise<string> {
    const { rows } = await ctx.db.query<{ id: string }>(
      'SELECT id FROM transactions WHERE date = $1',
      [date],
    )
    return rows[0]!.id
  }

  it('pushes a rise once, even when another charge posts on its day later', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    await refreshInbox(ctx)
    await postsAgainFirstInOrder(accountId)
    await refreshInbox(ctx)
    const { rows } = await ctx.db.query<{ subject: string }>(
      `SELECT subject FROM notifications WHERE kind = 'price_rise'`,
    )
    const october = await chargeOn('2026-10-12')
    expect(rows).toEqual([{ subject: `rise:${accountId}:2026-11-12:${october}:1099:1199` }])
  })

  it('pushes two like rises on one account and day apart', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    // A second plan at the same prices on the same days, under its own name.
    await ctx.db.query(
      `INSERT INTO transactions (account_id, provider_transaction_id, date, name, merchant_name,
         amount_cents, pending)
       SELECT account_id, provider_transaction_id || '-tidal', date, 'TIDAL MUSIC', 'Tidal',
         amount_cents, pending
       FROM transactions`,
    )
    await refreshInbox(ctx)
    const { rows } = await ctx.db.query<{ subject: string }>(
      `SELECT subject FROM notifications WHERE kind = 'price_rise'`,
    )
    expect(new Set(rows.map((row) => row.subject)).size).toBe(2)
  })

  it('keeps a hidden rise hidden when another charge posts on its day later', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    const [rise] = await leaks()
    await call('hide_home_alert', { kind: 'price_rise', accountId, chargeId: rise!.charge!.id })
    await postsAgainFirstInOrder(accountId)
    // The charge standing for the day is now the new one, yet the rise is the same.
    const risen = (await leaks()).find((alert) => alert.kind === 'price_rise')
    expect(risen!.charge!.id).not.toBe(rise!.charge!.id)
    const home = (await call('list_home_alerts')).alerts.map((alert) => alert.kind)
    expect(home).not.toContain('price_rise')
  })

  /**
   * Counts the reads of the recurring finder's history (recentHistory's SQL),
   * the costly part of the leak alerts: about 400 days of transactions.
   */
  function countHistoryReads(): () => number {
    const query = vi.spyOn(ctx.db, 'query')
    return () =>
      query.mock.calls.filter(([sql]) => /NOT a\.hidden AND t\.date BETWEEN/.test(String(sql)))
        .length
  }

  it('reads the history once for the suggestions and the leak alerts of a check-in', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    const reads = countHistoryReads()
    const checkin = await call('get_checkin')
    expect(checkin.alerts.map((alert) => alert.kind)).toContain('price_rise')
    // One read, shared by the suggestions and the leaks, which read it apart before.
    // Payday now comes from paychecks, so it no longer reads this history.
    expect(reads()).toBe(1)
  })

  it('reads the history once in a notifier run, for its notifications and home hides', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    const reads = countHistoryReads()
    await refreshInbox(ctx)
    expect(reads()).toBe(1)
  })

  it('notifies once with nothing from the bank on a locked screen, and hides from home for good', async () => {
    const { accountId } = await everyday(ctx.db)
    await chargedTwice(ctx.db, accountId)
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
    const { accountId } = await everyday(ctx.db)
    await chargedTwice(ctx.db, accountId)
    const error = await callError('hide_home_alert', { kind: 'duplicate_charge', accountId })
    expect(error.code).toBe('invalid_input')
    expect((await call('list_home_alerts')).alerts.map((alert) => alert.kind)).toEqual([
      'duplicate_charge',
    ])
  })

  it('hides one leak without hiding another on the same account', async () => {
    const { accountId } = await everyday(ctx.db)
    await chargedTwice(ctx.db, accountId)
    await spotifyRose(ctx.db, accountId)
    const rise = (await leaks()).find((alert) => alert.kind === 'price_rise')!
    await call('hide_home_alert', { kind: 'price_rise', accountId, chargeId: rise.charge!.id })
    expect((await call('list_home_alerts')).alerts.map((alert) => alert.kind)).toEqual([
      'duplicate_charge',
    ])
  })

  it('names the push words of a price rise with no merchant', async () => {
    const { accountId } = await everyday(ctx.db)
    await spotifyRose(ctx.db, accountId)
    await refreshInbox(ctx)
    const { rows } = await ctx.db.query<{ title: string; push_body: string }>(
      `SELECT title, push_body FROM notifications WHERE kind = 'price_rise'`,
    )
    expect(rows).toEqual([
      { title: 'Price went up', push_body: 'A repeating charge went up in price.' },
    ])
  })
})
