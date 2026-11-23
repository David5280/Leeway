// The migration that holds following back on the amounts bills already had
// (035), so following a varying bill's cycles never overwrites a figure the
// owner typed before amount_set_at existed. It marks varying bills and bills
// added by hand or by an assistant, keeps a null on steady bills tracked in
// one tap, leaves amount_set_at alone so a steady bill's price-change alert
// still shows, and changes nothing when run again.

import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { listBillChanges, settleBillChanges } from '../src/domain/billChangeSource.js'
import { migrate } from '../src/db/migrate.js'
import { addCharges, SWUNG, TODAY } from './fixtures/cityPower.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

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

const BACKFILL = '035_bill_follow_after.sql'
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))

/** A fresh database with every migration but the backfill. */
async function migratedWithoutBackfill(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'leeway-without-follow-after-'))
  const others = (await readdir(MIGRATIONS)).filter((file) => file !== BACKFILL)
  for (const file of others) await copyFile(join(MIGRATIONS, file), join(dir, file))
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

interface StoredBill {
  followAfter: Date | null
  setAt: Date | null
  cents: number
}

async function billsByName(): Promise<Record<string, StoredBill>> {
  const { rows } = await ctx.db.query<StoredBill & { name: string }>(
    `SELECT name, follow_after AS "followAfter", amount_set_at AS "setAt", amount_cents AS cents
     FROM bills ORDER BY name`,
  )
  return Object.fromEntries(rows.map(({ name, ...rest }) => [name, rest]))
}

/** A steady bill added by hand, `cents` usually, its charges `charges` (oldest first). */
async function steadyByHand(
  accountId: string,
  bill: { name: string; cents: number; cadence: 'month' | 'year' },
  charges: [date: string, cents: number][],
): Promise<void> {
  // Tracked well before its first charge, so none of them is the first since tracking.
  await ctx.db.query(
    `INSERT INTO bills (name, amount_cents, cadence, anchor_date, match_pattern, created_at)
     VALUES ($1, $2, $3, '2026-12-15', $4, '2025-01-01')`,
    [bill.name, bill.cents, bill.cadence, bill.name.toLowerCase()],
  )
  for (const [date, amountCents] of charges) {
    await insertBankTransaction(ctx.db, accountId, { date, name: bill.name, amountCents })
  }
}

describe('the follow-after migration', () => {
  it('marks varying and hand-added bills to follow from now, and leaves the rest', async () => {
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

    for (const name of ['By hand', 'Set since 034', 'Tracked, varying']) {
      const followAfter = bills[name]!.followAfter!
      // now() at the migration, which ran between the two clock readings.
      expect(followAfter.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
      expect(followAfter.getTime()).toBeLessThanOrEqual(after.getTime() + 1000)
    }
    expect(bills['Tracked, steady']!.followAfter).toBeNull()
    // Nothing says the owner set these amounts, so amount_set_at keeps what it had.
    expect(Object.values(bills).map((bill) => bill.setAt)).toEqual([
      null,
      new Date('2026-11-10T12:00:00Z'),
      null,
      null,
    ])
    // Amounts are never touched.
    expect(Object.values(bills).map((bill) => bill.cents)).toEqual([11000, 11000, 11000, 11000])
    expect(await migrate(ctx.db)).toEqual([])

    // Its SQL run a second time changes nothing either.
    await ctx.db.query(await readFile(join(MIGRATIONS, BACKFILL), 'utf8'))
    expect(await billsByName()).toEqual(bills)
  })

  it("keeps a steady hand-added bill's price-change alerts, monthly and yearly", async () => {
    await migratedWithoutBackfill()
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday' })
    // Two $15.49 charges, then $22.99: news, as it was before the upgrade.
    await steadyByHand(accountId, { name: 'Netflix', cents: 1549, cadence: 'month' }, [
      ['2026-09-15', 1549],
      ['2026-10-15', 1549],
      ['2026-11-15', 2299],
    ])
    // $12 a year, then $20: an alert hidden now would stay hidden a whole year.
    await steadyByHand(accountId, { name: 'Domain', cents: 1200, cadence: 'year' }, [
      ['2025-11-10', 1200],
      ['2026-11-10', 2000],
    ])
    await migrate(ctx.db)

    // Both are marked, being added by hand, yet only following waits on that.
    const bills = await billsByName()
    expect(bills['Netflix']!.followAfter).not.toBeNull()
    expect(bills['Domain']!.followAfter).not.toBeNull()
    const changes = await listBillChanges(ctx.db, 'UTC', TODAY)
    expect(changes.map((change) => [change.bill.name, change.kind]).sort()).toEqual([
      ['Domain', 'changed'],
      ['Netflix', 'changed'],
    ])
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
