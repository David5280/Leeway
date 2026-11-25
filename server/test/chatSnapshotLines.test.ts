// The snapshot's lines read from the money check-in, each from a check-in
// built by hand: what can be spent now, the budget period, bills by payday,
// debts, the trend and what needs attention. No database.

import { describe, expect, it } from 'vitest'
import {
  attentionLine,
  billsDueLine,
  checkinLines,
  debtsLine,
  periodLine,
  spendNowLine,
  trendLine,
  type LineFormat,
} from '../src/chat/snapshotLines.js'
import type { AttentionItem } from '../src/domain/coach.js'
import type { Spendable } from '../src/domain/spendable.js'
import { formatWholeCents } from '../src/lib/money.js'
import { checkin } from './fixtures/checkin.js'

/** Whole dollars, as the snapshot writes them. */
const format: LineFormat = { money: (cents) => formatWholeCents(cents), locale: 'en-US' }

/** What can be spent now, led by the budget, with a payday read from paychecks. */
function spendable(fields: Partial<Spendable> = {}): Spendable {
  return {
    safeCents: 90_000,
    shortfallCents: 0,
    overdraftCents: 0,
    budgetLeftCents: 57_000,
    leadCents: 57_000,
    limitedBy: 'budget',
    perDayCents: 4_100,
    cashKnown: true,
    payday: '2026-11-20',
    paydaySource: 'detected_income',
    paydayEstimate: false,
    note: null,
    problem: false,
    ...fields,
  }
}

const item = (
  topic: AttentionItem['topic'],
  priority: AttentionItem['priority'],
  tool: string,
) => ({
  topic,
  priority,
  tool,
  message: `Everyday Checking 4417 needs a look (${topic})`,
})

describe('what can be spent now', () => {
  it('leads with the figure and a day, until payday', () => {
    const line = spendNowLine(checkin({ spendable: spendable() }), format)
    expect(line).toBe('Can spend now: $570, $41 a day, before payday on Nov 20.')
  })

  it('says a guessed payday is a guess, and adds the note the dashboard shows', () => {
    const note = 'Checking may be $120 short of the bills before payday, best guess Nov 20.'
    const line = spendNowLine(
      checkin({ spendable: spendable({ paydayEstimate: true, leadCents: 0, note }) }),
      format,
    )
    expect(line).toBe(`Can spend now: $0, $41 a day, before payday, best guess Nov 20. ${note}`)
  })

  it('says nothing is known to spend, never $0, with neither a budget nor a checking balance', () => {
    const unknown =
      'Can spend now: not known (no budget and no checking balance yet), which is not $0.'
    expect(spendNowLine(checkin({ spendable: null }), format)).toBe(unknown)
    const none = spendable({ limitedBy: 'none', leadCents: 0, cashKnown: false })
    expect(spendNowLine(checkin({ spendable: none }), format)).toBe(unknown)
  })
})

describe('the budget period', () => {
  it('gives what is spent, where budgeted spending is heading and last period by this day', () => {
    const line = periodLine(checkin({ budget: { previousSpentToDateCents: 70_000 } }), format)
    expect(line).toBe(
      'This budget period (Nov 1 to Nov 30, 14 days left): $800 spent; budgeted spending heading for $1,600 of $2,000; $700 by this day last period.',
    )
  })

  it('says when no budgets are set, still giving the spending', () => {
    const line = periodLine(checkin({ budget: { budgetedCents: 0, daysLeft: 1 } }), format)
    expect(line).toBe(
      'This budget period (Nov 1 to Nov 30, 1 day left): no budgets set; $800 spent, $0 by this day last period.',
    )
  })
})

describe('bills, debts and the trend', () => {
  it('gives the bills due by payday, or that none are tracked', () => {
    const tracked = checkin({
      bills: { count: 2, monthlyCents: 9_000 },
      cashFlow: { billsDueCents: 6_000 },
    })
    expect(billsDueLine(tracked, format)).toBe('Bills due by payday: $60.')
    expect(billsDueLine(checkin(), format)).toBe(
      'Bills due by payday: not known, no bills are tracked.',
    )
  })

  it('gives what is owed and when minimums clear it', () => {
    const debts = {
      owedCents: 185_000,
      minimumsCents: 4_500,
      debtFreeDate: '2033-09-01',
      totalInterestCents: 182_400,
    }
    expect(debtsLine(checkin({ debts }), format)).toBe(
      'Debts: $1,850 owed on cards and loans, $45 a month in minimums; debt-free around September 2033 paying minimums ($1,824 interest).',
    )
    const never = { ...debts, debtFreeDate: null }
    expect(debtsLine(checkin({ debts: never }), format)).toBe(
      'Debts: $1,850 owed on cards and loans, $45 a month in minimums.',
    )
    expect(debtsLine(checkin(), format)).toBe('Debts: no card or loan has a balance.')
  })

  it('says which way net worth moved', () => {
    const down = checkin({ netWorth: { netWorthCents: 5_040_000, changeCents: -32_000 } })
    expect(trendLine(down, format)).toBe('Net worth: $50,400, down $320 over 30 days.')
    const up = checkin({ netWorth: { netWorthCents: 5_040_000, changeCents: 12_000 } })
    expect(trendLine(up, format)).toBe('Net worth: $50,400, up $120 over 30 days.')
    const still = checkin({ netWorth: { netWorthCents: 5_040_000, changeCents: 0 } })
    expect(trendLine(still, format)).toBe('Net worth: $50,400, unchanged over 30 days.')
  })
})

describe('what needs attention', () => {
  it('names the most urgent by topic and tool, never by the message', () => {
    const attention = [
      item('cash', 'now', 'get_cash_flow'),
      item('account', 'now', 'list_alerts'),
      item('bill', 'soon', 'list_bills'),
      item('goal', 'fyi', 'list_goals'),
      item('cleanup', 'fyi', 'list_transactions'),
    ]
    const line = attentionLine(checkin({ attention }))
    expect(line).toBe(
      'Needs attention, most urgent first: cash before payday, now (get_cash_flow); an account alert, now (list_alerts); a bill, soon (list_bills); and 2 more (get_checkin).',
    )
    expect(line).not.toMatch(/Everyday|4417/)
  })

  it('points an item at the check-in when its tool is not one Chat has', () => {
    const attention = [item('goal', 'soon', 'update_goal')]
    expect(attentionLine(checkin({ attention }))).toBe(
      'Needs attention, most urgent first: a goal, soon (get_checkin).',
    )
  })

  it('says when nothing needs attention', () => {
    expect(attentionLine(checkin())).toBe('Needs attention: nothing right now.')
  })
})

it('gives every line in the order the dashboard tells them', () => {
  const lines = checkinLines(checkin({ spendable: spendable() }), format)
  expect(lines.map((line) => line.split(':')[0])).toEqual([
    'Can spend now',
    'This budget period (Nov 1 to Nov 30, 14 days left)',
    'Bills due by payday',
    'Debts',
    'Net worth',
    'Needs attention',
  ])
})
