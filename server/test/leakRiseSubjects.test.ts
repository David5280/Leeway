// A price rise told before its subject changed, from its latest charge's id
// ("charge:<id>") to the rise itself: once moved, it is not pushed again,
// not back in the inbox and not back on home.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { refreshInbox } from '../src/domain/notifications/notifier.js'
import { oldRiseSubject } from '../src/domain/notifications/riseSubjects.js'
import { actionCaller } from './actionCaller.js'
import { everyday, spotifyRose } from './fixtures/leaks.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call } = actionCaller(() => ctx)

const NOW = new Date('2026-11-17T18:00:00Z')
/** When the rise was told and put away, before the subject changed. */
const TOLD = new Date('2026-11-13T09:00:00Z')

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
})

/** Spotify's rise on Nov 12, and the subjects it had before and has now. */
async function rose() {
  const { accountId } = await everyday(ctx.db)
  await spotifyRose(ctx.db, accountId)
  const rise = (await call('list_alerts', {})).find((alert) => alert.kind === 'price_rise')!
  const { rows } = await ctx.db.query<{ id: string }>(
    `SELECT id FROM transactions WHERE date = '2026-10-12'`,
  )
  return {
    accountId,
    rise,
    old: oldRiseSubject(rise),
    now: `rise:${accountId}:2026-11-12:${rows[0]!.id}:1099:1199`,
  }
}

/** A price-rise notification as stored, pushed and dismissed unless told otherwise. */
async function told(subject: string, fields: { pushState?: string; dismissed?: boolean } = {}) {
  await ctx.db.query(
    `INSERT INTO notifications (kind, subject, title, message, push_body, link, created_at,
       read_at, dismissed_at, push_state, pushed_at)
     VALUES ('price_rise', $1, 'Price went up', 'Spotify went up to $11.99, from $10.99.',
       'A repeating charge went up in price.', '/alerts', $2, $2, $3, $4, $5)`,
    [
      subject,
      TOLD,
      fields.dismissed === false ? null : TOLD,
      fields.pushState ?? 'sent',
      fields.pushState === 'pending' ? null : TOLD,
    ],
  )
}

const riseRows = async () =>
  (
    await ctx.db.query<{ subject: string; dismissed: boolean; push_state: string }>(
      `SELECT subject, dismissed_at IS NOT NULL AS dismissed, push_state
       FROM notifications WHERE kind = 'price_rise'`,
    )
  ).rows

const homeKinds = async () => (await call('list_home_alerts')).alerts.map((alert) => alert.kind)

describe('a price rise told under its old subject', () => {
  it('stays dismissed and pushed once, moved to its own subject', async () => {
    const { old, now } = await rose()
    await told(old)
    await refreshInbox(ctx)
    expect(await riseRows()).toEqual([{ subject: now, dismissed: true, push_state: 'sent' }])
    expect(await call('list_notifications')).toEqual({ items: [], unread: 0 })
    expect(await homeKinds()).not.toContain('price_rise')
  })

  it('keeps the owner’s dismissal over a copy told again under the new subject', async () => {
    const { old, now } = await rose()
    await told(old)
    // The version before this fix already told it again, still waiting to push.
    await told(now, { pushState: 'pending', dismissed: false })
    await refreshInbox(ctx)
    expect(await riseRows()).toEqual([{ subject: now, dismissed: true, push_state: 'sent' }])
  })

  it('stays hidden from home, with the hide moved to its own subject', async () => {
    const { old, now } = await rose()
    await told(old, { dismissed: false })
    // Hidden before the change, and since marked gone, as its old subject no longer showed.
    await ctx.db.query(
      `INSERT INTO alert_hides (kind, subject, hidden_at, cleared_at)
       VALUES ('price_rise', $1, $2, $2)`,
      [old, TOLD],
    )
    expect(await homeKinds()).toContain('price_rise')
    await refreshInbox(ctx)
    expect(await homeKinds()).not.toContain('price_rise')
    const { rows } = await ctx.db.query(`SELECT subject, cleared_at FROM alert_hides`)
    expect(rows).toEqual([{ subject: now, cleared_at: null }])
    expect(await riseRows()).toEqual([{ subject: now, dismissed: false, push_state: 'sent' }])
  })

  it('leaves a charge made twice under its own charge subject alone', async () => {
    const { old } = await rose()
    await ctx.db.query(
      `INSERT INTO alert_hides (kind, subject, hidden_at) VALUES ('duplicate_charge', $1, $2)`,
      [old, TOLD],
    )
    await refreshInbox(ctx)
    const { rows } = await ctx.db.query(`SELECT kind, subject FROM alert_hides`)
    expect(rows).toEqual([{ kind: 'duplicate_charge', subject: old }])
  })
})
