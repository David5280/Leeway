// The migration that marks the amounts bills already had as set by the owner
// (035), so following a varying bill's cycles never overwrites a figure the
// owner typed before amount_set_at existed. It marks varying bills and bills
// added by hand or by an assistant, keeps a null on steady bills tracked in
// one tap, never moves a time the owner set since, and runs once.

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { settleBillChanges } from '../src/domain/billChangeSource.js'
import { migrate } from '../src/db/migrate.js'
import { addCharges, SWUNG, TODAY } from './fixtures/cityPower.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

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

const BACKFILL = '035_bill_amount_set_backfill.sql'

/** A fresh database with every migration but the backfill. */
async function migratedWithoutBackfill(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'leeway-without-amount-set-backfill-'))
  const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
  const others = (await readdir(migrations)).filter((file) => file !== BACKFILL)
  for (const file of others) await copyFile(join(migrations, file), join(dir, file))
  await ctx.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate(ctx.db, dir)
}

/** A City Power bill tracked in June, stored as `fields` say, its amount $110. */
async function insertBill(
  name: string,
  fields: { accountId?: string | null; varies?: boolean; setAt?: string | null } = {},
): Promise<string> {
  const { rows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO bills (name, amount_cents, cadence, anchor_date, match_pattern, account_id,
       amount_varies, amount_set_at, created_at)
     VALUES ($1, 11000, 'month', '2026-11-20', 'city power', $2, $3, $4, '2026-06-25')
     RETURNING id`,
    [name, fields.accountId ?? null, fields.varies ?? false, fields.setAt ?? null],
  )
  return rows[0]!.id
}

async function billsByName(): Promise<Record<string, { setAt: Date | null; cents: number }>> {
  const { rows } = await ctx.db.query<{ name: string; setAt: Date | null; cents: number }>(
    'SELECT name, amount_set_at AS "setAt", amount_cents AS cents FROM bills',
  )
  return Object.fromEntries(rows.map(({ name, ...rest }) => [name, rest]))
}

describe('the amount set backfill migration', () => {
  it('marks varying and hand-added bills as set now, and leaves the rest', async () => {
    await migratedWithoutBackfill()
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    await insertBill('By hand')
    await insertBill('Tracked, varying', { accountId, varies: true })
    await insertBill('Tracked, steady', { accountId })
    await insertBill('Set since 034', { setAt: '2026-11-10T12:00:00Z' })

    const before = new Date()
    expect(await migrate(ctx.db)).toEqual([BACKFILL])
    const after = new Date()
    const bills = await billsByName()

    for (const name of ['By hand', 'Tracked, varying']) {
      const setAt = bills[name]!.setAt!
      // now() at the migration, which ran between the two clock readings.
      expect(setAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
      expect(setAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000)
    }
    expect(bills['Tracked, steady']!.setAt).toBeNull()
    expect(bills['Set since 034']!.setAt).toEqual(new Date('2026-11-10T12:00:00Z'))
    // Amounts are never touched.
    expect(Object.values(bills).map((bill) => bill.cents)).toEqual([11000, 11000, 11000, 11000])
    // Running again changes nothing.
    expect(await migrate(ctx.db)).toEqual([])
  })

  it("keeps the owner's typed amount on a varying bill through the first settle", async () => {
    await migratedWithoutBackfill()
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    // Added by hand at $110, its charges swinging since: following would move it.
    await insertBill('City Power')
    await addCharges(ctx.db, accountId, [...SWUNG, ['2026-11-16', 9000]])
    await migrate(ctx.db)
    expect(await settleBillChanges(ctx.db, 'UTC', TODAY)).toBe(0)
    expect((await billsByName())['City Power']!.cents).toBe(11000)
  })

  it('runs on a database with no bills', async () => {
    await migratedWithoutBackfill()
    expect(await migrate(ctx.db)).toEqual([BACKFILL])
    expect(await billsByName()).toEqual({})
  })
})
