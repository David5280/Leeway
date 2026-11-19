// An assistant over MCP can't confirm an account's mask by guessing it. Each
// tool that takes text an assistant chooses (a search, a rule, a bill's
// pattern, a repeating charge's key) is called twice: once with the mask's
// letters and once with letters found nowhere. Every answer, and everything
// the assistant can read afterwards, must be the same both times.

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
import { createToken } from '../src/domain/tokens.js'
import { buildApp } from '../src/http/app.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext
let app: FastifyInstance

beforeAll(async () => {
  ctx = await createTestContext()
  app = await buildApp(ctx, { webDir: null })
})
afterAll(async () => {
  await app.close()
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** The account's mask, in letters, and letters no bank text holds. */
const MASK = 'ab'
const NOWHERE = 'zq'

/** What a tool answered: its result, or the error it gave. */
interface Answer {
  isError: boolean
  body: unknown
}

/** Calls MCP tools as an assistant with a write token. */
async function assistant(): Promise<(name: string, args?: object) => Promise<Answer>> {
  const { token } = await createToken(ctx.db, 'Coach', 'write')
  return async (name, args = {}) => {
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
        params: { name, arguments: args },
      },
    })
    const result = response.json().result as { isError?: boolean; content: { text: string }[] }
    const text = result.content[0]!.text
    return { isError: result.isError === true, body: result.isError ? text : JSON.parse(text) }
  }
}

/** A bill as an assistant reads it, without what differs by design: its id and pattern. */
function billState(answer: Answer) {
  const { id: _id, matchPattern: _pattern, ...rest } = answer.body as Record<string, unknown>
  return { isError: answer.isError, ...rest }
}

describe("an account's mask, through MCP", () => {
  it('cannot be confirmed in letters through search, rules, bills or repeating charges', async () => {
    // Monthly dues whose bank text ends with the account's mask, as card text does.
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Checking', mask: 'AB' })
    for (const month of ['2026-08', '2026-09', '2026-10']) {
      await insertBankTransaction(ctx.db, accountId, {
        date: `${month}-20`,
        name: `GYM DUES ENDING ${MASK.toUpperCase()}`,
        amountCents: 4000,
      })
    }
    const fitness = await createCategory(ctx.db, categoryInputSchema.parse({ name: 'Fitness' }))
    const tool = await assistant()
    // Everything an assistant can read about the money that a guess could move.
    const everything = async () => ({
      transactions: await tool('list_transactions', { includeExcluded: true }),
      recurring: await tool('find_recurring'),
    })
    const before = await everything()
    expect(JSON.stringify(before)).not.toMatch(/\bab\b/i)

    /** Runs a probe with the mask's letters, then with letters found nowhere. */
    async function both<T>(probe: (letters: string) => Promise<T>): Promise<[T, T]> {
      return [await probe(MASK), await probe(NOWHERE)]
    }

    // A search.
    const [searchMask, searchNowhere] = await both((letters) =>
      tool('list_transactions', { search: `ending ${letters}` }),
    )
    expect(searchMask).toEqual(searchNowhere)

    // A rule, previewed and then made.
    const rule = (letters: string) => ({
      field: 'description',
      matchType: 'contains',
      pattern: `dues ending ${letters}`,
      categoryId: fitness.id,
    })
    const [previewMask, previewNowhere] = await both((letters) =>
      tool('preview_rule', rule(letters)),
    )
    expect(previewMask).toEqual(previewNowhere)
    const [madeMask, madeNowhere] = await both(async (letters) => {
      const made = await tool('create_rule', rule(letters))
      return { recategorized: (made.body as { recategorized: number }).recategorized }
    })
    expect(madeMask).toEqual(madeNowhere)
    expect(await everything()).toEqual(before)

    // A bill, added on the guess and then moved onto it.
    const bill = (letters: string) => ({
      name: 'Gym',
      amountCents: 4000,
      cadence: 'month',
      anchorDate: '2026-11-20',
      matchPattern: `gym dues ending ${letters}`,
    })
    const [addedMask, addedNowhere] = await both(async (letters) =>
      billState(await tool('create_bill', bill(letters))),
    )
    expect(addedMask).toEqual(addedNowhere)
    expect(await everything()).toEqual(before)
    const plain = await tool('create_bill', { ...bill(MASK), matchPattern: 'yoga' })
    const { id } = plain.body as { id: string }
    const [movedMask, movedNowhere] = await both(async (letters) =>
      billState(await tool('update_bill', { id, matchPattern: `gym dues ending ${letters}` })),
    )
    expect(movedMask).toEqual(movedNowhere)

    // A repeating charge, dismissed by a key made from the guess.
    const [dismissMask, dismissNowhere] = await both((letters) =>
      tool('dismiss_recurring', { key: `gym dues ending ${letters}` }),
    )
    expect(dismissMask).toEqual(dismissNowhere)
    expect(await everything()).toEqual(before)
  })
  it('is not shown with letters standing in for its digits', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Checking', mask: '4417' })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-02',
      name: 'POS STORE 44L7',
      merchantName: 'Store 44l7',
      amountCents: 1200,
    })
    const tool = await assistant()
    const { body } = await tool('list_transactions')
    expect(body).toMatchObject({ transactions: [{ displayName: 'Store' }] })
    expect(JSON.stringify(body)).not.toMatch(/44l7/i)
  })
})
