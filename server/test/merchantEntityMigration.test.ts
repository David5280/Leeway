// The merchant id migration (037) is numbered after ones main and other
// branches add (032, 034, and 029 to 036 held elsewhere). The runner applies
// any file it has not run, in name order, so a database that ran all of the
// others, later ones included, still gets 037, and one that ran it under an
// earlier name is not broken.

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { migrate } from '../src/db/migrate.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

let ctx: AppContext
let dir = ''

const ENTITY = '037_merchant_entity.sql'
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))

beforeAll(async () => {
  ctx = await createTestContext()
})
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})
afterAll(async () => {
  // Leave the database whole for the next file, whatever happened here.
  await migrate(ctx.db)
  await resetData(ctx.db)
  await ctx.db.end()
})

/** A fresh schema migrated with every file but the merchant id one, and that folder. */
async function withoutEntity(): Promise<string[]> {
  dir = await mkdtemp(join(tmpdir(), 'leeway-without-entity-'))
  const others = (await readdir(MIGRATIONS)).filter((file) => file !== ENTITY)
  for (const file of others) await copyFile(join(MIGRATIONS, file), join(dir, file))
  await ctx.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate(ctx.db, dir)
  return others
}

describe('the merchant id migration', () => {
  it('is the only one numbered 037, and sorts after every one numbered before it', async () => {
    const files = (await readdir(MIGRATIONS)).filter((file) => file.endsWith('.sql')).sort()
    expect(files.filter((file) => file.startsWith('037_'))).toEqual([ENTITY])
    const earlier = files.filter((file) => file < '037_')
    expect(files.indexOf(ENTITY)).toBe(earlier.length)
  })

  it('runs last on a database that already ran every other one, and keeps its rows', async () => {
    const others = await withoutEntity()
    expect(others).toEqual(
      expect.arrayContaining(['032_goal_order.sql', '034_bill_amount_set_at.sql']),
    )
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    await ctx.db.query(
      `INSERT INTO transactions (account_id, provider_transaction_id, date, name, amount_cents)
       VALUES ($1, 'tx-before', '2026-11-01', 'KING SOOPERS', 900)`,
      [accountId],
    )

    await copyFile(join(MIGRATIONS, ENTITY), join(dir, ENTITY))
    expect(await migrate(ctx.db, dir)).toEqual([ENTITY])
    const { rows } = await ctx.db.query('SELECT name, merchant_entity_id FROM transactions')
    expect(rows).toEqual([{ name: 'KING SOOPERS', merchant_entity_id: null }])
    expect(await migrate(ctx.db, dir)).toEqual([])
  })

  it('runs on a database that added the column under the earlier name', async () => {
    await withoutEntity()
    await ctx.db.query('ALTER TABLE transactions ADD COLUMN merchant_entity_id text')
    await copyFile(join(MIGRATIONS, ENTITY), join(dir, ENTITY))
    expect(await migrate(ctx.db, dir)).toEqual([ENTITY])
  })
})
