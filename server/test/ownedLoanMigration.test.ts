// The migration that lets a home or car name its loan (027) touches only its
// own column, so it can land after migrations numbered above it on another
// branch. A database that already ran every other migration still gets it,
// keeps what was entered, and refuses a thing tied to itself.

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

const LOAN_LINK = '027_owned_loan_link.sql'
/** Builds on 027's column, so it runs after it, as its number puts it on every install. */
const LOAN_UNIQUE = '033_owned_loan_unique.sql'

describe('the loan link migration', () => {
  it('runs on a database that already ran every other migration, keeping its accounts', async () => {
    dir = await mkdtemp(join(tmpdir(), 'leeway-without-loan-link-'))
    const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
    const others = (await readdir(migrations)).filter(
      (file) => file !== LOAN_LINK && file !== LOAN_UNIQUE,
    )
    for (const file of others) await copyFile(join(migrations, file), join(dir, file))
    await ctx.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await migrate(ctx.db, dir)

    // A home kept by hand before the column existed.
    const { rows } = await ctx.db.query<{ id: string }>(
      `INSERT INTO accounts (name, type, subtype, balance_cents, currency)
       VALUES ('House', 'property', 'home', 45000000, 'USD') RETURNING id`,
    )
    const home = rows[0]!.id

    expect(await migrate(ctx.db)).toEqual([LOAN_LINK, LOAN_UNIQUE])
    const kept = await ctx.db.query<{ balance: number; loan: string | null }>(
      'SELECT balance_cents AS balance, loan_account_id AS loan FROM accounts WHERE id = $1',
      [home],
    )
    expect(kept.rows[0]).toEqual({ balance: 45_000_000, loan: null })
    await expect(
      ctx.db.query('UPDATE accounts SET loan_account_id = id WHERE id = $1', [home]),
    ).rejects.toThrow(/accounts_loan_not_itself/)
    // Running again changes nothing.
    expect(await migrate(ctx.db)).toEqual([])
  })
})
