import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

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

// A well-formed id that matches no account.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

describe('account edge cases', () => {
  it("goes back to Leeway's name for the account when the owner's is cleared", async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'TOTAL CHECKING' })
    await call('update_account', { id: accountId, displayName: 'Bills' })

    const cleared = await call('update_account', { id: accountId, displayName: null })

    // The helper's bank is "Test Bank", so the account reads "Test Total Checking".
    expect(cleared).toMatchObject({
      name: 'Test Total Checking',
      nickname: null,
      bankName: 'TOTAL CHECKING',
    })
  })

  it('names the bank-owned fields it refuses to change', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const error = await callError('update_account', {
      id: accountId,
      type: 'credit',
      creditLimitCents: 100,
    })
    expect(error.message).toBe(
      'creditLimitCents, type come from the bank for linked accounts and cannot be edited',
    )
  })

  it('lets a manual account change type, limit and subtype, and clear them again', async () => {
    const card = await call('create_account', {
      name: 'Store card',
      type: 'other',
      balanceCents: 0,
    })

    const changed = await call('update_account', {
      id: card.id,
      type: 'credit',
      subtype: 'store',
      creditLimitCents: 50000,
    })
    expect(changed).toMatchObject({ type: 'credit', subtype: 'store', creditLimitCents: 50000 })

    const cleared = await call('update_account', {
      id: card.id,
      subtype: null,
      creditLimitCents: null,
    })
    expect(cleared).toMatchObject({ type: 'credit', subtype: null, creditLimitCents: null })
  })

  it('reports an unknown account as not found', async () => {
    const error = await callError('update_account', { id: UNKNOWN_ID, hidden: true })
    expect(error).toMatchObject({ code: 'not_found', message: 'Account not found' })
    expect((await callError('delete_account', { id: UNKNOWN_ID })).code).toBe('not_found')
  })
})
