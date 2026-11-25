// Keeping Chat's snapshot: built once, the same bytes while nothing
// changes, and built again after any change to the owner's data or day.
// Chat's own writes (its messages, notes and AI usage) change nothing.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as snapshotModule from '../src/chat/snapshot.js'
import { chatSnapshot } from '../src/chat/snapshotCache.js'
import type { AppContext } from '../src/context.js'
import { NO_PEOPLE } from '../src/domain/chat/people.js'
import { saveExchange, saveFact } from '../src/domain/chat/store.js'
import { dataFingerprint } from '../src/domain/dataFingerprint.js'
import { getSettings } from '../src/domain/settings.js'
import type { IsoDate } from '../src/lib/dates.js'
import { actionCaller } from './actionCaller.js'
import { seedFinances } from './fixtures/finances.js'
import { createTestContext, insertBankTransaction, resetData } from './helpers.js'

// Every build goes through the real buildSnapshot, counted.
vi.mock('../src/chat/snapshot.js', { spy: true })
const builds = vi.mocked(snapshotModule.buildSnapshot)

let ctx: AppContext
let logged: unknown[]
const caller = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-17T18:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await seedFinances(ctx, caller)
  logged = []
  builds.mockClear()
})

/** The snapshot a question on `today` would be sent. */
async function snapshotOn(today: IsoDate = '2026-11-17'): Promise<string | null> {
  const settings = await getSettings(ctx.db)
  return chatSnapshot(ctx, settings, today, NO_PEOPLE, (error) => logged.push(error))
}

/** The id of one of the seeded transactions. */
async function someTransactionId(): Promise<string> {
  const { rows } = await ctx.db.query<{ id: string }>('SELECT id FROM transactions LIMIT 1')
  return rows[0]!.id
}

describe('while nothing changes', () => {
  it('builds once and sends the same bytes on every question', async () => {
    const first = await snapshotOn()
    const second = await snapshotOn()
    const third = await snapshotOn()
    expect(first).toContain('Can spend now: $570')
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(builds).toHaveBeenCalledTimes(1)
  })

  it("is not rebuilt by Chat's own writes: messages, notes and AI usage", async () => {
    await snapshotOn()
    await saveExchange(ctx.db, 'How am I doing?', 'Well.', ctx.now())
    await saveFact(ctx.db, 'Saving for a wedding', ctx.now())
    await ctx.db.query(
      `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micros)
       VALUES ('chat', 'm', 1, 1, 0, 0, 0)`,
    )
    await snapshotOn()
    expect(builds).toHaveBeenCalledTimes(1)
  })
})

describe('after a change', () => {
  /** Makes the change between two questions, expecting exactly one new build for it. */
  async function around(change: () => Promise<unknown>) {
    const before = await snapshotOn()
    const built = builds.mock.calls.length
    await change()
    const after = await snapshotOn()
    expect(builds).toHaveBeenCalledTimes(built + 1)
    return { before: before!, after: after! }
  }

  it('is rebuilt when a sync moves a balance', async () => {
    const { before, after } = await around(() =>
      ctx.db.query(
        `UPDATE accounts SET balance_cents = balance_cents + 50000 WHERE type = 'investment'`,
      ),
    )
    expect(before).toContain('Retirement $40,000')
    expect(after).toContain('Retirement $40,500')
  })

  it('is rebuilt when a transaction is edited, added or deleted', async () => {
    const id = await someTransactionId()
    await around(() => caller.call('update_transaction', { id, note: 'checked' }))
    const { rows } = await ctx.db.query<{ id: string }>(
      'SELECT account_id AS id FROM transactions LIMIT 1',
    )
    await around(() =>
      insertBankTransaction(ctx.db, rows[0]!.id, {
        date: '2026-11-16',
        name: 'FARMERS MARKET',
        amountCents: 2_500,
      }),
    )
    await around(() => ctx.db.query('DELETE FROM transactions WHERE id = $1', [id]))
  })

  it('is rebuilt when a bill, goal, pay or setting changes', async () => {
    const { after } = await around(() =>
      caller.call('create_bill', {
        name: 'Internet',
        amountCents: 7_000,
        cadence: 'month',
        anchorDate: '2026-11-18',
      }),
    )
    expect(after).toContain('Bills due by payday: $130.')
    await around(() => caller.call('create_goal', { name: 'Bike', targetCents: 90_000 }))
    await around(() =>
      caller.call('set_pay', {
        pay: { amountCents: 250_000, cadence: 'biweek', nextPayday: '2026-11-20' },
      }),
    )
    await around(() => caller.call('update_settings', { retirement: { retirementAge: 60 } }))
  })

  it('is rebuilt when the day changes, even with the same data', async () => {
    await snapshotOn('2026-11-17')
    const tomorrow = await snapshotOn('2026-11-18')
    expect(tomorrow).toMatch(/^As of 2026-11-18\./)
    expect(builds).toHaveBeenCalledTimes(2)
  })
})

describe('when it can not be read', () => {
  it('does not keep a snapshot with a part missing, so the next question tries again', async () => {
    builds.mockResolvedValueOnce({ text: 'part missing', complete: false })
    expect(await snapshotOn()).toBe('part missing')
    const next = await snapshotOn()
    expect(next).toContain('Can spend now: $570')
    expect(builds).toHaveBeenCalledTimes(2)
  })

  it('gives null and reports the error when it can not be built at all', async () => {
    const failure = new Error('database gone')
    builds.mockRejectedValueOnce(failure)
    expect(await snapshotOn()).toBeNull()
    expect(logged).toEqual([failure])
  })
})

describe('the data fingerprint', () => {
  it('stays put while nothing is written, and moves on an insert, an update and a delete', async () => {
    const start = await dataFingerprint(ctx.db)
    expect(await dataFingerprint(ctx.db)).toBe(start)
    const id = await someTransactionId()
    await ctx.db.query(`UPDATE transactions SET note = 'seen' WHERE id = $1`, [id])
    const updated = await dataFingerprint(ctx.db)
    expect(updated).not.toBe(start)
    await ctx.db.query('DELETE FROM goals')
    const deleted = await dataFingerprint(ctx.db)
    expect(deleted).not.toBe(updated)
    await caller.call('create_category', { name: 'Gifts' })
    expect(await dataFingerprint(ctx.db)).not.toBe(deleted)
  })

  it('moves when an older writer commits after a newer one, as a long sync can', async () => {
    const { rows } = await ctx.db.query<{ id: string }>('SELECT id FROM transactions LIMIT 2')
    const [older, newer] = rows.map((row) => row.id)
    const sync = await ctx.db.connect()
    try {
      // The sync takes its id first, then a quick edit with a newer id commits before it.
      await sync.query('BEGIN')
      await sync.query(`UPDATE transactions SET note = 'synced' WHERE id = $1`, [older])
      await ctx.db.query(`UPDATE transactions SET note = 'edited' WHERE id = $1`, [newer])
      const beforeSync = await dataFingerprint(ctx.db)
      await sync.query('COMMIT')
      expect(await dataFingerprint(ctx.db)).not.toBe(beforeSync)
    } finally {
      sync.release()
    }
  })
})
