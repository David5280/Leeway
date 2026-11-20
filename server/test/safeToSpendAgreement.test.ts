// Every surface that says what is safe to spend reads the one figure from
// getCashFlow: the Overview's hero and Budgets (get_budget's spendable), the
// widget, the check-in, the summary and what the AI is told, can-I-afford,
// and an assistant over MCP. One synthetic history, checked across all of them.

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSettings } from '../src/domain/settings.js'
import { summaryFacts } from '../src/domain/summaryText.js'
import { createToken } from '../src/domain/tokens.js'
import { getWidgetSummary } from '../src/domain/widget.js'
import { buildApp } from '../src/http/app.js'
import { formatWholeCents } from '../src/lib/money.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const NOW = new Date('2026-11-17T18:00:00Z')
const TODAY = '2026-11-17'

let ctx: Awaited<ReturnType<typeof createTestContext>>
let app: FastifyInstance
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: NOW })
  app = await buildApp(ctx, { webDir: null, rateLimit: false })
})
afterAll(async () => {
  await app.close()
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
})

/** Calls an MCP tool as an assistant with a read token, and returns its result. */
async function overMcp(name: string, args: object = {}): Promise<Record<string, unknown>> {
  const { token } = await createToken(ctx.db, 'Coach', 'read')
  const response = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  })
  const result = response.json().result as { content: { text: string }[] }
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>
}

/**
 * $3,000 budgeted and nothing spent, but checking holds $320 available
 * ($400 balance, $80 pending), a $60 phone bill is due Friday, and the
 * biweekly paycheck lands Nov 27: $260 is safe to spend, $26 a day.
 */
async function cashBelowBudget() {
  const { accountId } = await insertBankAccount(ctx.db, {
    subtype: 'checking',
    balanceCents: 40_000,
  })
  await ctx.db.query('UPDATE accounts SET available_cents = 32000 WHERE id = $1', [accountId])
  for (const date of ['2026-10-16', '2026-10-30', '2026-11-13']) {
    await insertBankTransaction(ctx.db, accountId, {
      date,
      name: 'ACME PAYROLL',
      amountCents: -210_000,
      primary: 'INCOME',
      detailed: 'INCOME_SALARY',
    })
  }
  await call('create_category', { name: 'Groceries', budgetCents: 300_000 })
  await call('create_bill', {
    name: 'Phone',
    amountCents: 6_000,
    cadence: 'month',
    anchorDate: '2026-11-20',
  })
}

const NOTE =
  'Your budget has $3,000 left, but you have $260 you can safely spend before payday on Nov 27.'

describe('safe to spend agrees everywhere', () => {
  it('gives the same figure, per day and note on every surface', async () => {
    await cashBelowBudget()

    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({
      nextPayday: '2026-11-27',
      paydaySource: 'detected_income',
      cashCents: 32_000,
      billsDueCents: 6_000,
      safeCents: 26_000,
      shortfallCents: 0,
      perDayCents: 2_600,
    })

    // The hero and Budgets.
    const budget = await call('get_budget')
    expect(budget.spendable).toMatchObject({
      budgetLeftCents: 300_000,
      safeCents: 26_000,
      leadCents: 26_000,
      limitedBy: 'cash',
      perDayCents: 2_600,
      note: NOTE,
      problem: false,
    })
    expect(budget.totals.safePerDayCents).toBe(2_600)

    // The widget.
    const settings = await getSettings(ctx.db)
    const widget = await getWidgetSummary(ctx.db, settings, NOW, TODAY)
    expect(widget.headline).toEqual({
      kind: 'until_payday',
      cents: 26_000,
      perDayCents: 2_600,
      payday: '2026-11-27',
    })

    // The check-in an assistant reads.
    const checkin = await call('get_checkin')
    expect(checkin.cashFlow).toMatchObject({ safeCents: 26_000, perDayCents: 2_600 })
    expect(checkin.spendable).toEqual(budget.spendable)

    // The summary in Leeway's words, and what an AI writer is told.
    const summary = await call('get_summary')
    expect([summary.headline, ...summary.points]).toContain(NOTE)
    const money = (cents: number) => formatWholeCents(cents, settings.currency, settings.locale)
    expect(summaryFacts(checkin, settings, money).safeToSpend).toMatchObject({
      untilPayday: '$260',
      perDay: '$26',
      payday: 'Nov 27',
      paydayIsAnEstimate: false,
      note: NOTE,
    })

    // Can I afford it: the safe figure is where yes turns to no.
    expect((await call('can_i_afford', { amountCents: 26_000 })).verdict).not.toBe('no')
    expect((await call('can_i_afford', { amountCents: 26_001 })).verdict).toBe('no')

    // An assistant over MCP reads the same.
    expect(await overMcp('get_cash_flow')).toMatchObject({ safeCents: 26_000, perDayCents: 2_600 })
    expect((await overMcp('get_budget')).spendable).toEqual(budget.spendable)
  })
})
