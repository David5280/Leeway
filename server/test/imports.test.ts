// Importing transactions from a CSV file: validation, duplicates, categories,
// the size cap, undo, and the HTTP and MCP edges.

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { MAX_IMPORT_ROWS } from '../src/domain/imports.js'
import { createToken } from '../src/domain/tokens.js'
import { buildApp } from '../src/http/app.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
  TEST_SETUP_CODE,
} from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const row = (date: string, name: string, amountCents: number, category?: string | null) => ({
  date,
  name,
  amountCents,
  ...(category === undefined ? {} : { category }),
})

async function cashAccount(): Promise<string> {
  const account = await call('create_account', {
    name: 'Old checking',
    type: 'depository',
    balanceCents: 0,
  })
  return account.id
}

const listAll = async () =>
  (await call('list_transactions', { includeExcluded: true, limit: 500 })).transactions

describe('importing transactions', () => {
  it('adds rows to an existing account, marked as imported and editable', async () => {
    const accountId = await cashAccount()
    const result = await call('import_transactions', {
      accountId,
      fileName: 'history.csv',
      rows: [row('2025-01-02', 'Coffee', 450), row('2025-01-03', 'Paycheck', -250000)],
    })

    expect(result).toMatchObject({
      added: 2,
      alreadyThere: 0,
      repeatsInFile: 0,
      skippedByDate: 0,
      unknownCategories: [],
      account: { id: accountId, name: 'Old checking' },
    })
    expect(result.importId).toEqual(expect.any(String))
    const saved = await listAll()
    expect(saved.map((tx) => [tx.date, tx.name, tx.amountCents, tx.source, tx.manual])).toEqual([
      ['2025-01-03', 'Paycheck', -250000, 'import', true],
      ['2025-01-02', 'Coffee', 450, 'import', true],
    ])
    expect(await call('list_imports')).toEqual([
      {
        id: result.importId,
        accountId,
        accountName: 'Old checking',
        fileName: 'history.csv',
        added: 2,
        createdAt: expect.any(Date),
      },
    ])
  })

  it('creates a new manual account for the rows when asked', async () => {
    const result = await call('import_transactions', {
      newAccount: { name: 'Mint history', type: 'credit' },
      rows: [row('2025-01-02', 'Coffee', 450)],
    })
    expect(result.account).toMatchObject({
      name: 'Mint history',
      type: 'credit',
      manual: true,
      balanceCents: 0,
    })
    expect((await listAll())[0]).toMatchObject({ accountId: result.account.id, source: 'import' })
  })

  it('tells bank, hand-entered and imported transactions apart', async () => {
    const bank = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, bank.accountId, {
      date: '2025-01-01',
      name: 'Synced',
      amountCents: 100,
    })
    await call('create_transaction', {
      accountId: bank.accountId,
      date: '2025-01-01',
      name: 'Cash',
      amountCents: 200,
    })
    await call('import_transactions', {
      accountId: bank.accountId,
      rows: [row('2024-06-01', 'Old', 300)],
    })
    const sources = Object.fromEntries((await listAll()).map((tx) => [tx.name, tx.source]))
    expect(sources).toEqual({ Synced: 'bank', Cash: 'manual', Old: 'import' })
  })

  it('skips rows the account already has, from any source, and adds nothing on a second run', async () => {
    const bank = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, bank.accountId, {
      date: '2025-01-02',
      name: 'SHELL OIL #44',
      amountCents: 4000,
    })
    const rows = [row('2025-01-02', 'Shell Oil 44', 4000), row('2025-01-03', 'Groceries', 9000)]

    const first = await call('import_transactions', { accountId: bank.accountId, rows })
    expect(first).toMatchObject({ added: 1, alreadyThere: 1 })
    const second = await call('import_transactions', { accountId: bank.accountId, rows })
    expect(second).toMatchObject({ added: 0, alreadyThere: 2, importId: null })
    expect(await listAll()).toHaveLength(2)
    // An import that added nothing leaves nothing to undo.
    expect(await call('list_imports')).toHaveLength(1)
  })

  it('checks duplicates only within the same account', async () => {
    const first = await cashAccount()
    const other = await call('create_account', { name: 'Card', type: 'credit', balanceCents: 0 })
    const rows = [row('2025-01-02', 'Coffee', 450)]
    await call('import_transactions', { accountId: first, rows })
    expect(await call('import_transactions', { accountId: other.id, rows })).toMatchObject({
      added: 1,
    })
  })

  it('skips repeats within the file unless told to keep them', async () => {
    const accountId = await cashAccount()
    const rows = [row('2025-01-02', 'Coffee', 450), row('2025-01-02', 'Coffee', 450)]
    expect(await call('import_transactions', { accountId, rows })).toMatchObject({
      added: 1,
      repeatsInFile: 1,
    })
    expect(await call('import_transactions', { accountId, rows, keepRepeats: true })).toMatchObject(
      {
        added: 1,
        alreadyThere: 1,
      },
    )
    expect(await listAll()).toHaveLength(2)
  })

  it('skips rows from the day the bank history starts, when asked', async () => {
    const bank = await insertBankAccount(ctx.db)
    for (const date of ['2025-02-10', '2025-02-01', '2025-03-01']) {
      await insertBankTransaction(ctx.db, bank.accountId, { date, name: 'Synced', amountCents: 1 })
    }
    const rows = [row('2025-01-31', 'Older', 100), row('2025-02-01', 'Bank has it', 200)]

    const result = await call('import_transactions', {
      accountId: bank.accountId,
      skipBankDays: true,
      rows,
    })
    expect(result).toMatchObject({ added: 1, skippedByDate: 1, bankHistoryStarts: '2025-02-01' })
    expect((await listAll()).map((tx) => tx.name)).not.toContain('Bank has it')
    // Without the option, every new row is added.
    const all = await call('import_transactions', { accountId: bank.accountId, rows })
    expect(all).toMatchObject({
      added: 1,
      alreadyThere: 1,
      skippedByDate: 0,
      bankHistoryStarts: null,
    })
  })

  it('skips nothing by bank days on an account with no bank history', async () => {
    const accountId = await cashAccount()
    await call('create_transaction', {
      accountId,
      date: '2025-01-01',
      name: 'By hand',
      amountCents: 1,
    })
    const result = await call('import_transactions', {
      accountId,
      skipBankDays: true,
      rows: [row('2025-02-01', 'Late', 100)],
    })
    expect(result).toMatchObject({ added: 1, skippedByDate: 0, bankHistoryStarts: null })
  })

  it('reports an import that bank days empty without recording it', async () => {
    const bank = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, bank.accountId, {
      date: '2025-01-01',
      name: 'Synced',
      amountCents: 1,
    })
    const result = await call('import_transactions', {
      accountId: bank.accountId,
      skipBankDays: true,
      rows: [row('2025-02-01', 'Late', 100)],
    })
    expect(result).toMatchObject({ added: 0, skippedByDate: 1, importId: null })
    expect(await call('list_imports')).toEqual([])
  })
})

describe('categories on imported rows', () => {
  it('matches category names ignoring case, and they stick like a choice by hand', async () => {
    const dining = await call('create_category', { name: 'Dining Out' })
    const accountId = await cashAccount()
    await call('import_transactions', {
      accountId,
      rows: [row('2025-01-02', 'Taco stand', 1200, 'dining out')],
    })
    expect((await listAll())[0]).toMatchObject({ categoryId: dining.id, categorySource: 'manual' })
  })

  it('files rows without a known category by the rules and names the unknown ones', async () => {
    const coffee = await call('create_category', { name: 'Coffee' })
    await call('create_rule', { pattern: 'starbucks', categoryId: coffee.id })
    const accountId = await cashAccount()
    const result = await call('import_transactions', {
      accountId,
      rows: [
        row('2025-01-02', 'STARBUCKS #12', 500, null),
        row('2025-01-03', 'Starbucks', 600, 'Treats'),
        row('2025-01-04', 'Starbucks', 700, '  '),
        row('2025-01-05', 'Hardware store', 900, 'Home'),
        row('2025-01-06', 'Hardware store', 950, 'Treats'),
      ],
    })
    expect(result.unknownCategories).toEqual(['Home', 'Treats'])
    const byAmount = new Map((await listAll()).map((tx) => [tx.amountCents, tx]))
    expect(byAmount.get(500)).toMatchObject({ categoryId: coffee.id, categorySource: 'rule' })
    expect(byAmount.get(600)).toMatchObject({ categoryId: coffee.id, categorySource: 'rule' })
    expect(byAmount.get(700)).toMatchObject({ categoryId: coffee.id, categorySource: 'rule' })
    expect(byAmount.get(900)).toMatchObject({ categoryId: null, categorySource: null })
  })
})

describe('checking an import', () => {
  it('needs exactly one of an existing account or a new one', async () => {
    const accountId = await cashAccount()
    const rows = [row('2025-01-02', 'Coffee', 450)]
    const neither = await callError('import_transactions', { rows })
    expect(neither.message).toMatch(/Choose an existing account or name a new one/)
    const both = await callError('import_transactions', {
      accountId,
      newAccount: { name: 'X', type: 'depository' },
      rows,
    })
    expect(both.code).toBe('invalid_input')
  })

  it('refuses an account that does not exist, adding nothing', async () => {
    const error = await callError('import_transactions', {
      accountId: UNKNOWN_ID,
      rows: [row('2025-01-02', 'Coffee', 450)],
    })
    expect(error).toMatchObject({ code: 'invalid_input', message: 'That account does not exist' })
    expect(await listAll()).toEqual([])
  })

  it('refuses bad rows and names where they are', async () => {
    const accountId = await cashAccount()
    const cases: [unknown, RegExp][] = [
      [row('2025-02-30', 'Coffee', 450), /rows\.0\.date: Use a real date/],
      [row('01/02/2025', 'Coffee', 450), /rows\.0\.date/],
      [row('2025-01-02', '   ', 450), /rows\.0\.name: Every row needs a description/],
      [row('2025-01-02', 'Coffee', 4.5), /rows\.0\.amountCents/],
      [row('2025-01-02', 'Coffee', 1e12), /rows\.0\.amountCents/],
      [row('2025-01-02', 'x'.repeat(201), 450), /rows\.0\.name/],
    ]
    for (const [bad, message] of cases) {
      const error = await callError('import_transactions', { accountId, rows: [bad] })
      expect(error.message).toMatch(message)
    }
    expect((await callError('import_transactions', { accountId, rows: [] })).message).toMatch(
      /The file has no rows to import/,
    )
  })

  it('rejects the whole batch, and creates no account, when one row is bad', async () => {
    await callError('import_transactions', {
      newAccount: { name: 'Never made', type: 'depository' },
      rows: [row('2025-01-02', 'Fine', 100), row('2025-13-01', 'Bad', 100)],
    })
    expect(await listAll()).toEqual([])
    expect(await call('list_accounts')).toEqual([])
  })

  it(`takes up to ${MAX_IMPORT_ROWS} rows at once`, async () => {
    const accountId = await cashAccount()
    const many = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) =>
      row('2025-01-02', `Row ${i}`, i + 1),
    )
    expect(await call('import_transactions', { accountId, rows: many })).toMatchObject({
      added: MAX_IMPORT_ROWS,
    })
    const tooMany = [...many, row('2025-01-02', 'One more', 1)]
    expect((await callError('import_transactions', { accountId, rows: tooMany })).message).toMatch(
      /Import at most 20,000 rows at once/,
    )
  })

  it('is a write action that an assistant can also use', () => {
    expect(findAction('import_transactions')).toMatchObject({ scope: 'write', surface: 'all' })
    expect(findAction('undo_import')).toMatchObject({ scope: 'write', surface: 'all' })
    expect(findAction('list_imports')).toMatchObject({ scope: 'read', surface: 'all' })
  })
})

describe('undoing an import', () => {
  it('removes that import and only its transactions, even edited ones', async () => {
    const accountId = await cashAccount()
    await call('create_transaction', {
      accountId,
      date: '2025-01-02',
      name: 'By hand',
      amountCents: 100,
    })
    const kept = await call('import_transactions', {
      accountId,
      rows: [row('2025-01-03', 'Kept', 200)],
    })
    const undone = await call('import_transactions', {
      accountId,
      rows: [row('2025-01-04', 'Gone', 300), row('2025-01-05', 'Also gone', 400)],
    })
    const gone = (await listAll()).find((tx) => tx.name === 'Gone')!
    await call('update_transaction', { id: gone.id, note: 'edited since' })

    expect(await call('undo_import', { id: undone.importId })).toEqual({ removed: 2 })
    expect((await listAll()).map((tx) => tx.name).sort()).toEqual(['By hand', 'Kept'])
    expect((await call('list_imports')).map((i) => i.id)).toEqual([kept.importId])
  })

  it('says so when the import is already gone', async () => {
    const error = await callError('undo_import', { id: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'not_found' })
    expect(error.message).toMatch(/already undone/)
  })

  it('goes with its account when the account is deleted', async () => {
    const accountId = await cashAccount()
    await call('import_transactions', { accountId, rows: [row('2025-01-03', 'Old', 200)] })
    await call('delete_account', { id: accountId })
    expect(await call('list_imports')).toEqual([])
  })
})

describe('imports over HTTP and MCP', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp(ctx, { webDir: null, rateLimit: false })
  })
  afterAll(async () => {
    await app.close()
  })

  it('accepts a full-size import body from the app', async () => {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        email: 'me@example.com',
        password: 'correct horse battery',
        setupCode: TEST_SETUP_CODE,
      },
    })
    const cookie = `leeway_session=${setup.cookies[0]!.value}`
    const accountId = await cashAccount()
    // Long descriptions push this past the 2 MB other requests are held to.
    const rows = Array.from({ length: 15_000 }, (_, i) =>
      row('2025-01-02', `${'Long description '.repeat(10)}${i}`, i + 1),
    )
    const payload = JSON.stringify({ accountId, rows })
    expect(payload.length).toBeGreaterThan(2 * 1024 * 1024)

    const response = await app.inject({
      method: 'POST',
      url: '/api/actions/import_transactions',
      headers: { cookie, 'content-type': 'application/json' },
      payload,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().result.added).toBe(15_000)
  })

  it('refuses an import from a read-only assistant', async () => {
    const { token } = await createToken(ctx.db, 'Reader', 'read')
    const accountId = await cashAccount()
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'import_transactions',
          arguments: { accountId, rows: [row('2025-01-02', 'X', 1)] },
        },
      },
    })
    expect(response.json().result).toMatchObject({ isError: true })
    expect(await listAll()).toEqual([])
  })
})
