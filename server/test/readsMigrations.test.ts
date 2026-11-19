// The two migrations that say what a rule or bill reads (015 and 016) are
// numbered between ones main added before and after them (014 pensions and
// 017 paystubs). The runner tracks each file by name, so a database that
// already ran 014 and 017 still gets 015 and 016, and keeps every rule and
// bill reading the bank's text as it did.

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { migrate } from '../src/db/migrate.js'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
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

/** The migrations this branch adds, which land between ones already run. */
const READS = ['015_rule_reads.sql', '016_bill_reads.sql']

describe('the reads migrations', () => {
  it('run on a database that already ran the migrations numbered around them', async () => {
    // A database as main left it: every migration but these two, 014 and 017 included.
    dir = await mkdtemp(join(tmpdir(), 'leeway-without-reads-'))
    const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
    const others = (await readdir(migrations)).filter((file) => !READS.includes(file))
    expect(others).toEqual(expect.arrayContaining(['014_pensions.sql', '017_paystubs.sql']))
    for (const file of others) await copyFile(join(migrations, file), join(dir, file))
    await ctx.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await migrate(ctx.db, dir)

    // A rule and a bill the owner made before the columns existed.
    const fitness = await createCategory(ctx.db, categoryInputSchema.parse({ name: 'Fitness' }))
    await ctx.db.query(
      `INSERT INTO rules (field, match_type, pattern, category_id, position)
       VALUES ('description', 'contains', 'gym', $1, 0)`,
      [fitness.id],
    )
    await ctx.db.query(
      `INSERT INTO bills (name, amount_cents, cadence, anchor_date, match_pattern)
       VALUES ('Gym', 4000, 'month', '2026-11-20', 'gym')`,
    )

    // Only the two left out run, in order, and both keep what was there reading bank text.
    expect(await migrate(ctx.db)).toEqual(READS)
    const { rows } = await ctx.db.query<{ rule: string; bill: string }>(
      `SELECT (SELECT reads FROM rules) AS rule, (SELECT reads FROM bills) AS bill`,
    )
    expect(rows[0]).toEqual({ rule: 'bank_text', bill: 'bank_text' })
    // Running again changes nothing.
    expect(await migrate(ctx.db)).toEqual([])
  })
})
