// Shared setup for the tests that read what Chat sends a model from real rows,
// through the tools (chatPeople, chatTransfers, chatBills, chatMerchants and
// chatSearch tests): a fresh database each test, one checking account, and
// helpers to add a transaction and read a tool's output as the model would.

import { afterAll, beforeAll, beforeEach, expect } from 'vitest'
import { runChatTool } from '../src/chat/tools.js'
import { paymentPeople } from '../src/domain/chat/people.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

export const ACCOUNT_TRANSFER = 'TRANSFER_OUT_ACCOUNT_TRANSFER'
export const GROCERIES = 'FOOD_AND_DRINK_GROCERIES'

/** What a transaction is added with, beyond its line and amount. */
export interface PayFields {
  merchantName?: string
  detailed?: string
  note?: string
  date?: string
}

/** A transaction as the model reads it in list_transactions. */
export interface SentTransaction {
  id: string
  displayName: string
  note: string | null
}

export interface ChatProbe {
  ctx: Awaited<ReturnType<typeof createTestContext>>
  accountId: string
  /** Adds a transaction this month on the checking account, with an optional note. */
  pay(name: string, amountCents: number, fields?: PayFields): Promise<string>
  /** Runs a tool as Chat does and returns what the model is sent; it must not fail. */
  sent(tool: string, input?: unknown): Promise<string>
  /** Runs a tool as Chat does and returns the whole result, failures included. */
  run(tool: string, input?: unknown): Promise<{ content: string; isError: boolean }>
  /** The transactions list_transactions sends. */
  transactions(): Promise<SentTransaction[]>
  /** The notes of those transactions, leaving out the empty ones. */
  notes(): Promise<string[]>
  /** The merchants top_merchants sends, in its order. */
  merchants(): Promise<string[]>
}

/** Sets up a probe for every test in the file that calls it. */
export function useChatProbe(): ChatProbe {
  const probe = {} as ChatProbe
  beforeAll(async () => {
    probe.ctx = await createTestContext()
  })
  afterAll(async () => {
    await probe.ctx.db.end()
  })
  beforeEach(async () => {
    await resetData(probe.ctx.db)
    probe.ctx.setNow(new Date('2026-11-17T18:00:00Z'))
    const account = { name: 'Chase Total Checking', mask: '4417' }
    ;({ accountId: probe.accountId } = await insertBankAccount(probe.ctx.db, account))
  })

  probe.pay = async (name, amountCents, fields = {}) => {
    const { note, date = '2026-11-15', ...bank } = fields
    const row = { date, name, amountCents, ...bank }
    const id = await insertBankTransaction(probe.ctx.db, probe.accountId, row)
    if (note)
      await probe.ctx.db.query('UPDATE transactions SET note = $1 WHERE id = $2', [note, id])
    return id
  }
  probe.run = async (tool, input = {}) => {
    const people = await paymentPeople(probe.ctx.db)
    const call = { id: tool, name: tool, input }
    return runChatTool(probe.ctx, call, people, (error) => {
      throw error
    })
  }
  probe.sent = async (tool, input = {}) => {
    const result = await probe.run(tool, input)
    expect(result.isError).toBe(false)
    return result.content
  }
  probe.transactions = async () =>
    (JSON.parse(await probe.sent('list_transactions')) as { transactions: SentTransaction[] })
      .transactions
  probe.notes = async () => (await probe.transactions()).flatMap((tx) => (tx.note ? [tx.note] : []))
  probe.merchants = async () =>
    (JSON.parse(await probe.sent('top_merchants')) as { merchant: string }[]).map(
      (total) => total.merchant,
    )
  return probe
}
