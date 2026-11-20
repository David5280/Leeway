// Linking a bank that is already connected: refused before Plaid counts a new
// Item, unless the owner confirms a second, separate login; and flagged when
// it shows only after the exchange.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { sameAccount, type DuplicateBankDetails } from '../src/domain/sameBank.js'
import { actionCaller } from './actionCaller.js'
import { account, FakeBank } from './fakeBank.js'
import { createTestContext, resetData } from './helpers.js'

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
})

const CHASE = { id: 'ins_56', name: 'Chase' }
const BOK = { id: 'ins_14', name: 'BOK Financial' }

/** Links a bank the way the app does once Plaid's window closes. */
function link(publicToken: string, fields: Record<string, unknown> = {}) {
  return call('link_bank', { publicToken, institution: CHASE, accounts: [], ...fields })
}

/** Links a bank that must be refused, and returns the refusal. */
function refusedLink(publicToken: string, fields: Record<string, unknown> = {}) {
  return callError('link_bank', { publicToken, institution: CHASE, accounts: [], ...fields })
}

/** Connects Chase once, as the owner already has it. */
async function chaseConnected() {
  bank.institution = CHASE
  return link('public-chase')
}

const connectionCount = async () => (await call('list_connections')).length

describe('the same account, as Plaid names it', () => {
  it('matches the same name and mask, ignoring case and extra spaces', () => {
    expect(
      sameAccount(
        { name: 'Total Checking', mask: '1234' },
        { name: ' total  CHECKING', mask: '1234' },
      ),
    ).toBe(true)
  })

  it('needs the mask to match too', () => {
    expect(
      sameAccount({ name: 'Checking', mask: '1234' }, { name: 'Checking', mask: '9876' }),
    ).toBe(false)
  })

  it('never matches on a name alone, since many banks call an account Checking', () => {
    expect(sameAccount({ name: 'Checking', mask: null }, { name: 'Checking', mask: null })).toBe(
      false,
    )
    expect(sameAccount({ name: 'Checking', mask: '1234' }, { name: 'Checking', mask: null })).toBe(
      false,
    )
  })

  it('needs the name to match too', () => {
    expect(sameAccount({ name: 'Checking', mask: '1234' }, { name: 'Savings', mask: '1234' })).toBe(
      false,
    )
  })
})

describe('linking a bank that is already connected', () => {
  it('refuses before the public token is exchanged, so Plaid counts nothing new', async () => {
    const existing = await chaseConnected()

    const error = await refusedLink('public-chase-again')

    expect(error).toMatchObject({ code: 'duplicate_bank', status: 409 })
    expect(error.message).toBe(
      'Chase is already connected. Keep the login you have, or confirm that this is a different login.',
    )
    expect(error.details).toEqual<DuplicateBankDetails>({
      institutionName: 'Chase',
      logins: [
        {
          connectionId: existing.connectionId,
          institutionName: 'Chase',
          status: 'active',
          sameAccounts: false,
        },
      ],
    })
    expect(bank.exchanged).toEqual(['public-chase'])
    expect(await connectionCount()).toBe(1)
  })

  it('says so more surely when the accounts picked are ones it already brings in', async () => {
    await chaseConnected()

    // The fake bank's checking account is named Checking, with the mask 0000.
    const error = await refusedLink('public-chase-again', {
      accounts: [
        { name: 'Savings', mask: '5555' },
        { name: 'checking', mask: '0000' },
      ],
    })

    expect(error.message).toBe(
      'Chase is already connected with these accounts. Keep the login you have, or reconnect it to repair it or add accounts.',
    )
    expect((error.details as DuplicateBankDetails).logins[0]?.sameAccounts).toBe(true)
  })

  it('lists every login at that bank, oldest first, with how each is doing', async () => {
    const first = await chaseConnected()
    const second = await link('public-chase-2', { allowSecondLogin: true })
    await ctx.db.query(`UPDATE connections SET status = 'needs_reauth' WHERE id = $1`, [
      second.connectionId,
    ])

    const error = await refusedLink('public-chase-3')

    const { logins } = error.details as DuplicateBankDetails
    expect(logins.map((login) => [login.connectionId, login.status])).toEqual([
      [first.connectionId, 'active'],
      [second.connectionId, 'needs_reauth'],
    ])
  })

  it('links a second login when the owner confirms it is a separate one', async () => {
    await chaseConnected()

    const second = await link('public-chase-partner', { allowSecondLogin: true })

    expect(second).toMatchObject({
      institutionName: 'Chase',
      error: null,
      possibleDuplicateOf: null,
    })
    expect(bank.exchanged).toEqual(['public-chase', 'public-chase-partner'])
    expect(await connectionCount()).toBe(2)
  })

  it('links a different bank without asking', async () => {
    await chaseConnected()
    bank.institution = BOK

    const result = await link('public-bok', { institution: BOK })

    expect(result).toMatchObject({ institutionName: 'BOK Financial', possibleDuplicateOf: null })
    expect(await connectionCount()).toBe(2)
  })

  it('links the first bank without asking', async () => {
    const result = await chaseConnected()
    expect(result).toMatchObject({ institutionName: 'Chase', possibleDuplicateOf: null })
  })
})

describe('a duplicate that shows only after the exchange', () => {
  it('keeps and flags a new login when the window did not say which bank it was', async () => {
    const existing = await chaseConnected()

    const result = await link('public-unnamed', { institution: null })

    expect(result.possibleDuplicateOf).toBe(existing.connectionId)
    expect(bank.exchanged).toEqual(['public-chase', 'public-unnamed'])
    // Removing it would not give its place back, and it may be the login that still works.
    expect(bank.removedItems).toEqual([])
    expect(await connectionCount()).toBe(2)
  })

  it('goes by the bank Plaid names, not only the one the window reported', async () => {
    const existing = await chaseConnected()

    // The window says BOK, but Plaid says the login it just counted is at Chase.
    const result = await link('public-mislabeled', { institution: BOK })

    expect(result.possibleDuplicateOf).toBe(existing.connectionId)
  })

  it('cannot flag a login when neither the window nor Plaid names its bank', async () => {
    await chaseConnected()
    bank.institution = { id: null, name: null }

    const result = await link('public-nameless', { institution: null })

    expect(result).toMatchObject({ institutionName: null, possibleDuplicateOf: null })
    expect(await connectionCount()).toBe(2)
  })

  it('does not flag a confirmed second login', async () => {
    await chaseConnected()
    const result = await link('public-unnamed', { institution: null, allowSecondLogin: true })
    expect(result.possibleDuplicateOf).toBeNull()
  })

  it('does not count the same login, linked again, as its own duplicate', async () => {
    const first = await link('public-same', { institution: null })

    const again = await link('public-same', { institution: null })

    expect(again.connectionId).toBe(first.connectionId)
    expect(again.possibleDuplicateOf).toBeNull()
  })
})

describe('what link_bank accepts', () => {
  it('takes a public token alone, naming no bank and no accounts', async () => {
    const result = await call('link_bank', { publicToken: 'public-1' })
    expect(result).toMatchObject({ institutionName: 'First Platypus Bank', error: null })
  })

  it.each([
    ['a bank with no id', { institution: { id: '', name: 'Chase' } }, 'institution.id'],
    ['a bank with no name', { institution: { id: 'ins_1', name: '  ' } }, 'institution.name'],
    [
      'a mask too long to be one',
      { accounts: [{ name: 'Checking', mask: '1'.repeat(11) }] },
      'accounts.0.mask',
    ],
    [
      'more accounts than any login has',
      { accounts: Array(101).fill({ name: 'A', mask: null }) },
      'accounts',
    ],
    ['a yes that is not a boolean', { allowSecondLogin: 'yes' }, 'allowSecondLogin'],
  ])('refuses %s', async (_, fields, path) => {
    const error = await callError('link_bank', { publicToken: 'public-1', ...fields })
    expect(error.code).toBe('invalid_input')
    expect(error.details).toEqual([expect.objectContaining({ path })])
    expect(bank.exchanged).toEqual([])
  })
})

describe('reconnecting a bank to choose its accounts', () => {
  it('asks the bank to let the owner choose accounts for that login', async () => {
    bank.accounts = [account('acc-checking', 'Checking', 'depository', 100)]
    const { connectionId } = await chaseConnected()

    await call('create_link_token', { connectionId, chooseAccounts: true })

    expect(bank.linkTokenRequests.at(-1)).toEqual({
      accessToken: 'access-public-chase',
      chooseAccounts: true,
      webhookUrl: null,
    })
  })

  it('repairs a login alone when choosing accounts was not asked for', async () => {
    const { connectionId } = await chaseConnected()
    await call('create_link_token', { connectionId })
    expect(bank.linkTokenRequests.at(-1)).toMatchObject({ chooseAccounts: false })
  })

  it('refuses to choose accounts with no login to reconnect', async () => {
    const error = await callError('create_link_token', { chooseAccounts: true })
    expect(error).toMatchObject({
      code: 'invalid_input',
      message: 'chooseAccounts: Choosing accounts needs the connection to reconnect',
    })
    expect(bank.linkTokenRequests).toEqual([])
  })
})
