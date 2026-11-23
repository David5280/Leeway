// Reordering goals locks every goal before it renumbers them, the same way a
// change to the emergency fund does. A goal made between that lock and the
// renumbering was never locked by the reorder, so the reorder must leave it
// alone: a fund change that locked it first would otherwise wait on the
// reorder while the reorder waits on it.

import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { reorderGoals } from '../src/domain/goalRanking.js'
import { actionCaller } from './actionCaller.js'
import { household } from './fixtures/emergency.js'
import { createTestContext, resetData } from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver.
let ctx: AppContext
const caller = actionCaller(() => ctx)
const { call } = caller

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "America/Denver"}'`)
})

/** An id that sorts before any random one, so a fund change locks this goal first. */
const FIRST_ID = '00000000-0000-4000-8000-000000000001'

const names = async () => (await call('list_goals')).map((goal) => goal.name)

/** Resolves once some query on the test database is waiting for a lock. */
async function someoneWaits(): Promise<void> {
  for (let tries = 0; tries < 300; tries++) {
    const { rows } = await ctx.db.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    )
    if (rows[0]!.waiting > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('No query ever waited for a lock')
}

/**
 * A transaction's client that holds still right after its first FOR UPDATE
 * (the lock step of reorderGoals) until `resume` is called.
 */
function pausedAfterLock(client: pg.PoolClient) {
  let onLocked!: () => void
  let resume!: () => void
  const locked = new Promise<void>((resolve) => (onLocked = resolve))
  const resumed = new Promise<void>((resolve) => (resume = resolve))
  const query = async (text: string, values?: unknown[]) => {
    const result = await client.query(text, values)
    if (text.includes('FOR UPDATE')) {
      onLocked()
      await resumed
    }
    return result
  }
  // reorderGoals only ever calls query, so that is all this client needs.
  const paused = { query } as unknown as pg.PoolClient
  return { paused, locked, resume }
}

describe('a reorder that meets a new goal and a fund change', () => {
  it('finishes without a deadlock, leaving the new goal last', async () => {
    await household(ctx.db, caller)
    await call('create_goal', { name: 'Trip', targetCents: 120_000 })
    const fund = await call('start_emergency_fund')

    const client = await ctx.db.connect()
    try {
      const { paused, locked, resume } = pausedAfterLock(client)
      await client.query('BEGIN')
      const reorder = reorderGoals(paused, [fund.id]).then(() => client.query('COMMIT'))
      await locked
      // Made after the reorder's lock, and locked first by the fund change below.
      await ctx.db.query(`INSERT INTO goals (id, name, target_cents) VALUES ($1, 'Late', 10000)`, [
        FIRST_ID,
      ])
      const change = call('change_emergency_fund', { months: 3 })
      await someoneWaits()
      resume()
      await Promise.all([reorder, change])
    } finally {
      // Ends the transaction if the reorder failed; a warning only once it committed.
      await client.query('ROLLBACK')
      client.release()
    }

    expect(await names()).toEqual(['Emergency fund', 'Trip', 'Late'])
    expect((await call('get_emergency_fund'))!.months).toBe(3)
  })
})
