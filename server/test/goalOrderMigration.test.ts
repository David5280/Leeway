// Migration 032 ranks the goals an install already has: oldest first, by name
// within the same moment, with a new goal joining after them. It lands after
// migrations main ran before it, so it must work on a database that has goals.

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { migrate } from '../src/db/migrate.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
let dir: string

beforeAll(async () => {
  ctx = await createTestContext()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})
afterAll(async () => {
  // Leave the database whole for the next file, whatever happened here.
  await migrate(ctx.db)
  await resetData(ctx.db)
  await ctx.db.end()
})

const GOAL_ORDER = '032_goal_order.sql'

/** Goals by name, in their ranked order. */
async function ranked() {
  const { rows } = await ctx.db.query<{ name: string; position: number }>(
    'SELECT name, position FROM goals ORDER BY position',
  )
  return rows.map((row) => [row.name, row.position])
}

describe('the goal order migration', () => {
  it('ranks existing goals oldest first, then a new goal last, and runs once', async () => {
    // A database with every other migration run, the emergency fund's 028 included.
    dir = await mkdtemp(join(tmpdir(), 'leeway-without-goal-order-'))
    const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
    const others = (await readdir(migrations)).filter((file) => file !== GOAL_ORDER)
    expect(others).toContain('028_emergency_fund.sql')
    for (const file of others) await copyFile(join(migrations, file), join(dir, file))
    await ctx.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await migrate(ctx.db, dir)

    // Goals the owner made before ranking existed: Bike and Art at the same moment.
    await ctx.db.query(
      `INSERT INTO goals (name, target_cents, created_at) VALUES
         ('Trip', 100000, '2026-10-01T12:00:00Z'),
         ('Bike', 50000, '2026-09-01T12:00:00Z'),
         ('Art', 20000, '2026-09-01T12:00:00Z')`,
    )

    expect(await migrate(ctx.db)).toEqual([GOAL_ORDER])
    expect(await ranked()).toEqual([
      ['Art', 1],
      ['Bike', 2],
      ['Trip', 3],
    ])
    await ctx.db.query(`INSERT INTO goals (name, target_cents) VALUES ('Car', 300000)`)
    expect((await ranked()).at(-1)).toEqual(['Car', 4])
    // Running again changes nothing.
    expect(await migrate(ctx.db)).toEqual([])
  })
})
