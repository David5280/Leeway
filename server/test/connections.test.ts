import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BankError } from '../src/bank/provider.js'
import type { AppContext } from '../src/context.js'
import { actionList } from '../src/actions/index.js'
import { UNREADABLE_TOKEN } from '../src/domain/bank.js'
import { handleBankWebhook } from '../src/domain/connections.js'
import { encrypt } from '../src/lib/crypto.js'
import { actionCaller } from './actionCaller.js'
import { account, bankTx, FakeBank, page } from './fakeBank.js'
import { createTestContext, resetData, TEST_KEY_HEX } from './helpers.js'

let ctx: AppContext
let bank: FakeBank
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  bank = new FakeBank()
  ctx.bank = bank
  ctx.config.publicUrl = null
})

// A well-formed id that matches no connection.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

const transactionCount = async () =>
  (await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions')).rows[0]?.n

const connectionStatus = async (id: string) =>
  (await call('list_connections')).find((c) => c.id === id)

describe('starting a bank link', () => {
  it('asks the bank for a new-link token, with no webhook when there is no public URL', async () => {
    expect(await call('create_link_token')).toEqual({ linkToken: 'link-new' })
    expect(bank.linkTokenRequests).toEqual([{ webhookUrl: null }])
  })

  it('points the bank at the webhook endpoint when the server has a public URL', async () => {
    ctx.config.publicUrl = 'https://leeway.example.com'
    await call('create_link_token')
    expect(bank.linkTokenRequests[0]).toEqual({
      webhookUrl: 'https://leeway.example.com/api/webhooks/plaid',
    })
  })

  it('repairs an existing login by sending its decrypted access token', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })

    const { linkToken } = await call('create_link_token', { connectionId })

    expect(linkToken).toBe('link-update-access-public-1')
  })

  it('reports an unknown connection as not found', async () => {
    const error = await callError('create_link_token', { connectionId: UNKNOWN_ID })
    expect(error).toMatchObject({ code: 'not_found', message: 'Connection not found' })
  })

  it('turns a bank failure into a readable bank error', async () => {
    bank.failNext = new BankError('Plaid is down (500)')
    const error = await callError('create_link_token')
    expect(error).toMatchObject({ code: 'bank_error', status: 502, message: 'Plaid is down (500)' })
  })
})

describe('finishing a bank link', () => {
  it('saves the bank and pulls its accounts and history', async () => {
    bank.pages = [page({ added: [bankTx({ name: 'Coffee', amountCents: 500 })] })]

    const result = await call('link_bank', { publicToken: 'public-1' })

    expect(result).toMatchObject({
      institutionName: 'First Platypus Bank',
      added: 1,
      error: null,
    })
    expect(await call('list_connections')).toEqual([
      expect.objectContaining({ status: 'active', accountCount: 1, lastError: null }),
    ])
  })

  it('updates the same connection when a bank is linked again', async () => {
    const first = await call('link_bank', { publicToken: 'public-1' })
    await ctx.db.query(`UPDATE connections SET status = 'error', last_error = 'boom'`)

    const second = await call('link_bank', { publicToken: 'public-1' })

    expect(second.connectionId).toBe(first.connectionId)
    expect(await call('list_connections')).toEqual([
      expect.objectContaining({ status: 'active', lastError: null }),
    ])
  })

  it('reports a failed token exchange and saves nothing', async () => {
    bank.failNext = new BankError('That link expired')
    const error = await callError('link_bank', { publicToken: 'public-1' })
    expect(error).toMatchObject({ code: 'bank_error', message: 'That link expired' })
    expect(await call('list_connections')).toEqual([])
  })

  it('needs a public token', async () => {
    expect((await callError('link_bank', { publicToken: '' })).code).toBe('invalid_input')
  })
})

describe('syncing banks', () => {
  it('syncs one connection when given its id', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    await call('link_bank', { publicToken: 'public-2' })
    bank.pages = [page({ added: [bankTx({ name: 'Lunch', amountCents: 1500 })] })]

    const results = await call('sync_banks', { connectionId })

    expect(results).toEqual([expect.objectContaining({ connectionId, added: 1 })])
  })

  it('syncs every connection, and one broken bank does not stop the others', async () => {
    const first = await call('link_bank', { publicToken: 'public-1' })
    const second = await call('link_bank', { publicToken: 'public-2' })
    bank.failNext = new BankError('Bank is having trouble (INSTITUTION_DOWN)')

    const results = await call('sync_banks')

    expect(results.map((r) => r.connectionId)).toEqual([first.connectionId, second.connectionId])
    expect(results[0]?.error).toContain('INSTITUTION_DOWN')
    expect(results[1]?.error).toBeNull()
    expect(await connectionStatus(first.connectionId)).toMatchObject({
      status: 'error',
      lastError: 'Bank is having trouble (INSTITUTION_DOWN)',
    })
  })

  it('follows every page the bank has before saving', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    bank.pages = [
      page({ added: [bankTx({ name: 'One', amountCents: 100 })], hasMore: true }),
      page({ added: [bankTx({ name: 'Two', amountCents: 200 })], hasMore: true }),
      page({ added: [bankTx({ name: 'Three', amountCents: 300 })] }),
    ]

    const [result] = await call('sync_banks', { connectionId })

    expect(result?.added).toBe(3)
    expect(await transactionCount()).toBe(3)
  })

  it('skips transactions for an account the bank no longer reports', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    bank.accounts = [account('acc-new', 'New checking', 'depository', 1000)]
    bank.pages = [
      page({
        added: [
          bankTx({ name: 'Kept', amountCents: 100, providerAccountId: 'acc-new' }),
          bankTx({ name: 'Orphan', amountCents: 200, providerAccountId: 'acc-gone' }),
        ],
      }),
    ]

    await call('sync_banks', { connectionId })

    const { transactions } = await call('list_transactions')
    expect(transactions.map((t) => t.name)).toEqual(['Kept'])
  })

  it('marks the connection errored and rethrows when sync fails for an unexpected reason', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    bank.failNext = new Error('socket hang up')

    await expect(call('sync_banks', { connectionId })).rejects.toThrow('socket hang up')

    expect(await connectionStatus(connectionId)).toMatchObject({
      status: 'error',
      lastError: 'socket hang up',
    })
  })

  it('reports an unknown connection as not found', async () => {
    expect((await callError('sync_banks', { connectionId: UNKNOWN_ID })).code).toBe('not_found')
  })

  it('returns an empty list when there are no banks', async () => {
    expect(await call('sync_banks')).toEqual([])
  })
})

describe('repairing a bank login', () => {
  it('marks the connection healthy again and catches up', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    await ctx.db.query(`UPDATE connections SET status = 'needs_reauth', last_error = 'Log in'`)
    bank.pages = [page({ added: [bankTx({ name: 'Missed', amountCents: 700 })] })]

    const result = await call('bank_reconnected', { connectionId })

    expect(result).toMatchObject({ connectionId, added: 1, error: null })
    expect(await connectionStatus(connectionId)).toMatchObject({
      status: 'active',
      lastError: null,
    })
  })
})

describe('removing a bank', () => {
  it('tells the bank, then deletes the connection with its accounts and transactions', async () => {
    bank.pages = [page({ added: [bankTx({ name: 'Gym', amountCents: 4000 })] })]
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })

    expect(await call('remove_connection', { id: connectionId })).toEqual({ deleted: true })

    expect(bank.removedItems).toEqual(['access-public-1'])
    expect(await call('list_connections')).toEqual([])
    expect(await call('list_accounts')).toEqual([])
    expect(await transactionCount()).toBe(0)
  })

  it('still removes the bank locally when the bank cannot be told', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    bank.failNext = new BankError('Plaid is down')

    await call('remove_connection', { id: connectionId })

    expect(await call('list_connections')).toEqual([])
  })

  it('still removes the bank locally when bank sync has since been turned off', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    ctx.bank = null

    await call('remove_connection', { id: connectionId })

    expect(await call('list_connections')).toEqual([])
  })

  it('reports an unknown connection as not found', async () => {
    expect((await callError('remove_connection', { id: UNKNOWN_ID })).code).toBe('not_found')
  })
})

describe("a bank's access token", () => {
  it('is stored encrypted and never comes back from any action that reads', async () => {
    await call('link_bank', { publicToken: 'public-1' })
    const { rows } = await ctx.db.query<{ stored: string }>(
      'SELECT access_token_encrypted AS stored FROM connections',
    )
    const stored = rows[0]!.stored
    expect(stored).not.toContain('access-public-1')

    for (const action of actionList.filter((a) => a.scope === 'read')) {
      // Actions that need input fail here, which leaks nothing either.
      const result = await call(action.name).catch(() => null)
      const text = JSON.stringify(result) ?? ''
      expect(text, action.name).not.toContain('access-public-1')
      expect(text, action.name).not.toContain(stored.split(':')[3]!)
    }
  })
})

describe('a saved bank login that no longer decrypts', () => {
  /** Links a bank, then runs as if ENCRYPTION_KEY had been changed since. */
  async function linkThenChangeKey(): Promise<string> {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    ctx.config.encryptionKey = Buffer.alloc(32, 9)
    return connectionId
  }
  const originalKey = Buffer.from(TEST_KEY_HEX, 'hex')
  afterEach(() => {
    ctx.config.encryptionKey = originalKey
  })

  it('marks the bank as needing attention, and keeps syncing the others', async () => {
    const broken = await linkThenChangeKey()
    ctx.config.encryptionKey = originalKey
    await call('link_bank', { publicToken: 'public-2' })
    ctx.config.encryptionKey = Buffer.alloc(32, 9)
    // Only the second bank's token is readable with the key in use now.
    await ctx.db.query('UPDATE connections SET access_token_encrypted = $2 WHERE id <> $1', [
      broken,
      encrypt('access-public-2', ctx.config.encryptionKey),
    ])

    const results = await call('sync_banks', {})

    expect(results.map((r) => r.error)).toEqual([UNREADABLE_TOKEN, null])
    expect(await connectionStatus(broken)).toMatchObject({
      status: 'needs_reauth',
      lastError: UNREADABLE_TOKEN,
    })
  })

  it('explains itself when the owner tries to repair the login', async () => {
    const connectionId = await linkThenChangeKey()
    const error = await callError('create_link_token', { connectionId })
    expect(error).toMatchObject({ code: 'bank_error', message: UNREADABLE_TOKEN })
  })

  it('can still be removed, without telling the bank it cannot reach', async () => {
    const connectionId = await linkThenChangeKey()

    expect(await call('remove_connection', { id: connectionId })).toEqual({ deleted: true })

    expect(bank.removedItems).toEqual([])
    expect(await call('list_connections')).toEqual([])
  })
})

describe('without a bank configured', () => {
  beforeEach(() => {
    ctx.bank = null
  })

  it.each([
    ['create_link_token', {}],
    ['link_bank', { publicToken: 'public-1' }],
    ['sync_banks', { connectionId: UNKNOWN_ID }],
    ['bank_reconnected', { connectionId: UNKNOWN_ID }],
  ] as const)('%s explains which keys to add', async (name, input) => {
    const error = await callError(name, input)
    expect(error).toMatchObject({ code: 'not_configured', status: 503 })
    expect(error.message).toContain('PLAID_CLIENT_ID and PLAID_SECRET')
  })

  it('still lists connections', async () => {
    expect(await call('list_connections')).toEqual([])
  })
})

describe('bank webhooks', () => {
  it('ignores events it does not act on and items it does not know', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })
    bank.pages = [page({ added: [bankTx({ name: 'Late', amountCents: 100 })] })]

    await handleBankWebhook(ctx, 'item-public-1', 'ignored')
    await handleBankWebhook(ctx, 'item-unknown', 'sync')

    expect(await transactionCount()).toBe(0)
    expect(await connectionStatus(connectionId)).toMatchObject({ status: 'active' })
  })

  it('flags a connection that needs the owner to log in again', async () => {
    const { connectionId } = await call('link_bank', { publicToken: 'public-1' })

    await handleBankWebhook(ctx, 'item-public-1', 'needs_reauth')

    expect(await connectionStatus(connectionId)).toMatchObject({
      status: 'needs_reauth',
      lastError: 'The bank needs you to log in again',
    })
  })

  it('pulls new transactions when the bank says there are updates', async () => {
    await call('link_bank', { publicToken: 'public-1' })
    bank.pages = [page({ added: [bankTx({ name: 'Fresh', amountCents: 100 })] })]

    await handleBankWebhook(ctx, 'item-public-1', 'sync')

    expect(await transactionCount()).toBe(1)
  })
})
