// Every surface that says what is safe to spend reads the one figure from
// getCashFlow: the Overview's hero and Budgets (get_budget's spendable), the
// widget, the check-in, the summary and what the AI is told, can-I-afford,
// and an assistant over MCP. One synthetic history, checked across all of them.

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSettings } from '../src/domain/settings.js'
import { summaryFacts } from '../src/domain/summaryFacts.js'
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

/** A checking account; null leaves its balance unknown, as before a first sync. */
async function checking(balanceCents: number | null, availableCents: number | null = null) {
  const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents })
  if (availableCents !== null) {
    await ctx.db.query('UPDATE accounts SET available_cents = $2 WHERE id = $1', [
      accountId,
      availableCents,
    ])
  }
  return accountId
}

/** A $2,100 paycheck every other Friday into the account; the last of `dates` is the newest. */
async function paidBiweekly(accountId: string, dates = ['2026-10-16', '2026-10-30', '2026-11-13']) {
  for (const date of dates) {
    await insertBankTransaction(ctx.db, accountId, {
      date,
      name: 'ACME PAYROLL',
      amountCents: -210_000,
      primary: 'INCOME',
      detailed: 'INCOME_SALARY',
    })
  }
}

const budgeted = (budgetCents: number) =>
  call('create_category', { name: 'Groceries', budgetCents })

const bill = (name: string, amountCents: number, anchorDate: string) =>
  call('create_bill', { name, amountCents, cadence: 'month', anchorDate })

/** What every surface says can be spent now, read the way each reads it. */
async function everySurface() {
  const settings = await getSettings(ctx.db)
  const money = (cents: number) => formatWholeCents(cents, settings.currency, settings.locale)
  const checkin = await call('get_checkin')
  const summary = await call('get_summary')
  return {
    money,
    budget: await call('get_budget'),
    cashFlow: await call('get_cash_flow'),
    widget: await getWidgetSummary(ctx.db, settings, NOW, TODAY),
    checkin,
    summaryLines: [summary.headline, ...summary.points],
    facts: summaryFacts(checkin, settings, money),
    afford: await call('can_i_afford', { amountCents: 1 }),
    mcpBudget: (await overMcp('get_budget')).spendable,
    mcpCashFlow: (await overMcp('get_cash_flow')).spendable,
  }
}

type Surfaces = Awaited<ReturnType<typeof everySurface>>

/** Every amount a sentence gives just before the words that follow it, like "$36 a day". */
const amountsBefore = (lines: string[], words: string) =>
  [...lines.join(' ').matchAll(new RegExp(`(\\$[\\d,]+) ${words}`, 'g'))].map((m) => m[1])

/**
 * Every surface gives the one figure and its money a day: the hero and
 * Budgets (get_budget), get_cash_flow, the check-in, the widget, the plain
 * summary, what the AI is told, can-I-afford and MCP.
 */
function expectAgreement(
  surfaces: Surfaces,
  want: { leadCents: number; perDayCents: number; limitedBy: 'budget' | 'cash' },
) {
  const { money, budget } = surfaces
  const room = budget.spendable!
  // The hero and Budgets: the lead figure, its caption's money a day.
  expect(room).toMatchObject(want)
  expect(budget.totals.safePerDayCents).toBe(want.perDayCents)
  // Every other copy of spendable is the same object.
  for (const copy of [
    surfaces.cashFlow.spendable,
    surfaces.checkin.spendable,
    surfaces.mcpBudget,
    surfaces.mcpCashFlow,
  ]) {
    expect(copy).toEqual(room)
  }
  // The widget leads with the same figure and money a day.
  expect(surfaces.widget.headline).toMatchObject({
    kind: want.limitedBy === 'budget' ? 'leeway' : 'until_payday',
    cents: want.leadCents,
  })
  if (want.leadCents > 0) {
    expect(surfaces.widget.headline.perDayCents).toBe(want.perDayCents)
  }
  // What the AI is told to quote.
  expect(surfaces.facts.spendNow).toMatchObject({
    amount: money(want.leadCents),
    perDay: money(want.perDayCents),
    limitedBy: want.limitedBy,
  })
  // The plain summary never names another figure to spend, or another money a day.
  for (const said of amountsBefore(surfaces.summaryLines, 'a day')) {
    expect(said).toBe(money(want.perDayCents))
  }
  for (const said of amountsBefore(
    surfaces.summaryLines,
    '(is safe to spend|you can safely spend)',
  )) {
    expect(said).toBe(money(want.leadCents))
  }
  // Can I afford it starts from the same money a day.
  expect(surfaces.afford.perDayBeforeCents).toBe(want.perDayCents)
}

describe('safe to spend agrees everywhere', () => {
  it('when checking holds less than the budget has left', async () => {
    // $3,000 budgeted, $320 available of a $400 balance, a $60 phone bill Friday,
    // payday Nov 27: $260 is safe, $26 a day.
    const accountId = await checking(40_000, 32_000)
    await paidBiweekly(accountId)
    await budgeted(300_000)
    await bill('Phone', 6_000, '2026-11-20')
    const surfaces = await everySurface()
    expect(surfaces.cashFlow).toMatchObject({
      nextPayday: '2026-11-27',
      paydaySource: 'detected_income',
      cashCents: 32_000,
      billsDueCents: 6_000,
      safeCents: 26_000,
      shortfallCents: 0,
    })
    expectAgreement(surfaces, { leadCents: 26_000, perDayCents: 2_600, limitedBy: 'cash' })
    const note =
      'Your budget has $3,000 left, but you have $260 you can safely spend before payday on Nov 27.'
    expect(surfaces.budget.spendable).toMatchObject({ note, problem: false })
    expect(surfaces.summaryLines).toContain(note)
    expect(surfaces.facts.spendNow?.note).toBe(note)
    // Can I afford it: the safe figure is where yes turns to no.
    expect((await call('can_i_afford', { amountCents: 26_000 })).verdict).not.toBe('no')
    expect((await call('can_i_afford', { amountCents: 26_001 })).verdict).toBe('no')
  })

  it('when the budget has less left than checking holds', async () => {
    // $500 budgeted, $2,000 in checking: the budget leads at about $36 a day for 14 days.
    const accountId = await checking(200_000)
    await paidBiweekly(accountId)
    await budgeted(50_000)
    const surfaces = await everySurface()
    expectAgreement(surfaces, { leadCents: 50_000, perDayCents: 3_571, limitedBy: 'budget' })
    expect(surfaces.budget.spendable!.note).toBeNull()
    expect(surfaces.summaryLines[0]).toBe(
      "You're on track: $500 left, about $36 a day for 14 days.",
    )
    // The cash behind it is detail, never a second figure to spend.
    expect(surfaces.summaryLines.join(' ')).not.toContain('$2,000')
    expect(surfaces.facts.cashInChecking?.safeToSpendBeforePayday).toBe('$2,000')
    expect(surfaces.afford.reasons[0]).toBe(
      'It fits: you would still have about $35.71 a day to spend.',
    )
  })

  it('when the bills before payday outrun the cash', async () => {
    // $50 in checking and a $200 bill Friday: nothing is safe, $150 short.
    const accountId = await checking(5_000)
    await paidBiweekly(accountId)
    await budgeted(300_000)
    await bill('Power', 20_000, '2026-11-20')
    const surfaces = await everySurface()
    expectAgreement(surfaces, { leadCents: 0, perDayCents: 0, limitedBy: 'cash' })
    const note = 'Checking is $150 short of the bills before payday on Nov 27.'
    expect(surfaces.budget.spendable).toMatchObject({ shortfallCents: 15_000, note, problem: true })
    expect(surfaces.widget.headline).toMatchObject({ cents: 0, shortfallCents: 15_000 })
    expect(surfaces.summaryLines).toContain(note)
  })

  it('when an account is overdrawn and the cash leads', async () => {
    // $500 in one account, $30 below zero in another: $470 is safe, after the overdraft.
    const accountId = await checking(50_000)
    await checking(-3_000)
    await paidBiweekly(accountId)
    await budgeted(300_000)
    const surfaces = await everySurface()
    expectAgreement(surfaces, { leadCents: 47_000, perDayCents: 4_700, limitedBy: 'cash' })
    expect(surfaces.budget.spendable).toMatchObject({
      overdraftCents: 3_000,
      problem: true,
      note: 'Your budget has $3,000 left, but you have $470 you can safely spend before payday on Nov 27. That is after $30 to bring an overdraft back to zero.',
    })
  })

  it('when an account is overdrawn but the budget leads', async () => {
    // $200 budgeted is less than the $470 safe: the overdrawn account's own alert says
    // it, so no second line repeats it beside the budget.
    const accountId = await checking(50_000)
    await checking(-3_000)
    await paidBiweekly(accountId)
    await budgeted(20_000)
    const surfaces = await everySurface()
    expectAgreement(surfaces, { leadCents: 20_000, perDayCents: 1_428, limitedBy: 'budget' })
    expect(surfaces.budget.spendable).toMatchObject({ note: null, problem: false })
    expect(surfaces.summaryLines.join(' ')).not.toContain('needs $30 to get back to zero')
  })

  it('when no checking balance is known yet', async () => {
    // Linked, but not synced: the budget alone says what is left.
    const accountId = await checking(null)
    await paidBiweekly(accountId)
    await budgeted(50_000)
    const surfaces = await everySurface()
    expectAgreement(surfaces, { leadCents: 50_000, perDayCents: 3_571, limitedBy: 'budget' })
    expect(surfaces.facts).toMatchObject({
      spendNow: { checkingBalanceKnown: false, note: null },
      cashInChecking: null,
    })
    // A $10 purchase fits the budget; the cash is not judged, and the reason says so.
    const afford = await call('can_i_afford', { amountCents: 1_000 })
    expect(afford).toMatchObject({ verdict: 'yes', cashKnown: false, leftAfterBillsCents: null })
    expect(afford.reasons).toEqual([
      'It fits the budget. Leeway has no checking balance yet, so this weighs the budget alone, not the cash.',
    ])
  })

  it('when payday comes before the period ends', async () => {
    // Paid Nov 6, so next on Nov 20, 3 days counting today. $300 safe would be $100
    // a day, but the $1,000 budget over 14 days allows $71: the lesser leads everywhere.
    const accountId = await checking(30_000)
    await paidBiweekly(accountId, ['2026-10-09', '2026-10-23', '2026-11-06'])
    await budgeted(100_000)
    const surfaces = await everySurface()
    expect(surfaces.cashFlow).toMatchObject({ nextPayday: '2026-11-20', perDayCents: 10_000 })
    expectAgreement(surfaces, { leadCents: 30_000, perDayCents: 7_142, limitedBy: 'cash' })
  })
})
