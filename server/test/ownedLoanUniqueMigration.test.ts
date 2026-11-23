// The migration that ties a loan to one thing only (033). An install may
// already hold a loan tied to two homes, saved before the app checked: the
// migration keeps the tie on the thing added first (the lowest id breaking a
// tie), undoes the others, and then the database refuses a second tie. Until
// it runs, saving such a home with its loan unchanged is no conflict.

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { migrate } from '../src/db/migrate.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext
let dir: string
const { call } = actionCaller(() => ctx)

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

const LOAN_UNIQUE = '033_owned_loan_unique.sql'

/** A fresh database with every migration but 033 run, as an install has before it. */
async function migratedWithoutLoanUnique(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'leeway-without-loan-unique-'))
  const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
  const others = (await readdir(migrations)).filter((file) => file !== LOAN_UNIQUE)
  for (const file of others) await copyFile(join(migrations, file), join(dir, file))
  await ctx.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate(ctx.db, dir)
}

/** Inserts a manual account, added at `createdAt`, tied to `loanId`, with the id given when one is. */
async function insertAccount(fields: {
  name: string
  type: 'loan' | 'property'
  createdAt: string
  loanId?: string
  id?: string
}): Promise<string> {
  const { rows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO accounts (id, name, type, subtype, balance_cents, currency, created_at, loan_account_id)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, 100, 'USD', $5, $6)
     RETURNING id`,
    [
      fields.id ?? null,
      fields.name,
      fields.type,
      fields.type === 'property' ? 'home' : null,
      fields.createdAt,
      fields.loanId ?? null,
    ],
  )
  return rows[0]!.id
}

/** The loan each account names, by name. */
async function ties(): Promise<Record<string, string | null>> {
  const { rows } = await ctx.db.query<{ name: string; loan: string | null }>(
    `SELECT a.name, l.name AS loan FROM accounts a
     LEFT JOIN accounts l ON l.id = a.loan_account_id
     WHERE a.type = 'property' ORDER BY a.name`,
  )
  return Object.fromEntries(rows.map((row) => [row.name, row.loan]))
}

describe('the one loan, one home migration', () => {
  it('keeps the tie on the home added first, undoes the rest, then refuses a second tie', async () => {
    await migratedWithoutLoanUnique()
    const mortgage = await insertAccount({
      name: 'Mortgage',
      type: 'loan',
      createdAt: '2026-01-01',
    })
    const heloc = await insertAccount({ name: 'HELOC', type: 'loan', createdAt: '2026-01-01' })
    const autoLoan = await insertAccount({ name: 'Auto', type: 'loan', createdAt: '2026-01-01' })
    // Added later, but holding the same loan as the house: its tie goes.
    const cabin = await insertAccount({
      name: 'Cabin',
      type: 'property',
      createdAt: '2026-03-01',
      loanId: mortgage,
    })
    await insertAccount({
      name: 'House',
      type: 'property',
      createdAt: '2026-02-01',
      loanId: mortgage,
    })
    // Added the same moment: the lowest id keeps the tie.
    const sameMoment = '2026-04-01'
    await insertAccount({
      name: 'Lake lot',
      type: 'property',
      createdAt: sameMoment,
      loanId: heloc,
      id: 'ffffffff-0000-4000-8000-000000000000',
    })
    await insertAccount({
      name: 'Barn',
      type: 'property',
      createdAt: sameMoment,
      loanId: heloc,
      id: '00000000-0000-4000-8000-000000000000',
    })
    // A loan tied once is left alone.
    await insertAccount({
      name: 'Garage',
      type: 'property',
      createdAt: '2026-05-01',
      loanId: autoLoan,
    })

    // Before the migration, saving the cabin with the loan it names already is no conflict.
    await expect(
      call('update_owned_or_owed', { id: cabin, name: 'Cabin', loanId: mortgage }),
    ).resolves.toMatchObject({ name: 'Cabin' })

    expect(await migrate(ctx.db)).toEqual([LOAN_UNIQUE])
    expect(await ties()).toEqual({
      Barn: 'HELOC',
      Cabin: null,
      Garage: 'Auto',
      House: 'Mortgage',
      'Lake lot': null,
    })
    await expect(
      ctx.db.query('UPDATE accounts SET loan_account_id = $1 WHERE id = $2', [mortgage, cabin]),
    ).rejects.toThrow(/accounts_loan_account_unique/)
    // Running again changes nothing.
    expect(await migrate(ctx.db)).toEqual([])
  })
})
