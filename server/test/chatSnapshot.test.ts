// Chat's bird's-eye snapshot, built from a realistic made-up household
// (fixtures/finances.ts) and from a fresh install: the real figures, what
// Leeway does not know, nothing private, and a small size.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildSnapshot, type BuiltSnapshot } from '../src/chat/snapshot.js'
import type { AppContext } from '../src/context.js'
import { paymentPeople } from '../src/domain/chat/people.js'
import { RATE_GUARD_FOR_AI } from '../src/domain/savings/rate.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import { PRIVATE_WORDS, seedFinances } from './fixtures/finances.js'
import { createTestContext, resetData } from './helpers.js'

/** The most the snapshot may cost each question, in tokens, counted roughly as characters / 4. */
const TOKEN_CEILING = 600

let ctx: AppContext
let logged: unknown[]
const caller = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-17T18:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  logged = []
})

async function snapshot(): Promise<BuiltSnapshot> {
  const settings = await getSettings(ctx.db)
  const people = await paymentPeople(ctx.db)
  return buildSnapshot(ctx, settings, '2026-11-17', people, (error) => logged.push(error))
}

describe('a household with a few months of history', () => {
  let built: BuiltSnapshot
  beforeEach(async () => {
    await seedFinances(ctx, caller)
    built = await snapshot()
  })

  it('opens with what can be spent now and the rest of the check-in, in real figures', () => {
    expect(built.complete).toBe(true)
    expect(logged).toEqual([])
    expect(built.text.split('\n').slice(0, 7)).toEqual([
      'As of 2026-11-17. Amounts in USD.',
      'Can spend now: $570, $41 a day, before payday on Nov 20.',
      'This budget period (Nov 1 to Nov 30, 13 days left): $2,180 spent; budgeted spending heading for $4,112 of $2,900; $2,330 by this day last period.',
      'Bills due by payday: $60.',
      'Debts: $1,850 owed on cards and loans, $45 a month in minimums; debt-free around September 2033 paying minimums ($1,824 interest).',
      'Net worth: $50,400, up $0 over 30 days.',
      'Needs attention, most urgent first: a bill, soon (list_bills); a budget, soon (get_budget); tidying up, fyi (list_transactions); and 1 more (get_checkin).',
    ])
  })

  it('then gives the profile: pay, a month, accounts, savings, goals and retirement', () => {
    const facts = [
      'Pay: every 2 weeks from Acme Corp Payroll since Aug 14, about $2,400 each, next on Nov 20.',
      'Accounts: Checking $3,250 (1 account); Savings $9,000 (1 account); Retirement $40,000 (1 account); Credit cards $1,850 owed (1 account).',
      'Saved and invested: $49,000 (savings $9,000, retirement $40,000).',
      'Emergency fund: savings cover 3.9 months of essentials',
      'Savings rate seen at the bank: about 5% of take-home pay',
      'Goals: Vacation 26% ($2,200 to go by Jun 1, behind pace).',
      'Retirement at 65 (now about 35): savings $61,851 to $191,892',
      'not a promise',
    ]
    for (const fact of facts) expect(built.text).toContain(fact)
    // The profile's opening line would only repeat the date and currency.
    expect(built.text).not.toContain('Financial profile as of')
  })

  it('counts paychecks only as pay: money from a person is not income', () => {
    // 26 paychecks of $2,400 a year is $5,218 a month; the $150 from a person is left out.
    expect(built.text).toContain('$5,218 take-home pay in from the current employer')
  })

  it('names no account, mask or person, and never repeats the savings rate guard', () => {
    // The words include every account's name and mask, and the person's name.
    for (const word of PRIVATE_WORDS) expect(built.text).not.toContain(word)
    // CHAT_SYSTEM gives the guard once; the snapshot does not pay for it on every question.
    expect(built.text).not.toContain(RATE_GUARD_FOR_AI)
  })

  it("hides a person named in the owner's own words, as a tool result would", async () => {
    await caller.call('create_goal', { name: 'Gift for Jordan Avery', targetCents: 20_000 })
    const { text } = await snapshot()
    expect(text).not.toMatch(/Jordan|Avery/)
    expect(text).toContain('Gift for someone')
  })

  it(`stays well under ${TOKEN_CEILING} tokens`, () => {
    expect(built.text.length / 4).toBeLessThan(TOKEN_CEILING)
  })

  it('is the same, byte for byte, when built again from the same data', async () => {
    expect((await snapshot()).text).toBe(built.text)
  })
})

describe('a fresh install', () => {
  it('says what Leeway does not know, so the model asks or reads instead of assuming', async () => {
    const { text, complete } = await snapshot()
    expect(complete).toBe(true)
    expect(text.split('\n')).toEqual([
      'As of 2026-11-17. Amounts in USD.',
      'Can spend now: not known (no budget and no checking balance yet), which is not $0.',
      'This budget period (Nov 1 to Nov 30, 13 days left): no budgets set; $0 spent, $0 by this day last period.',
      'Bills due by payday: not known, no bills are tracked.',
      'Debts: no card or loan has a balance.',
      'Net worth: $0, up $0 over 30 days.',
      'Needs attention: nothing right now.',
      'Not known yet: pay schedule, a typical month of spending, take-home pay (no paychecks from a current employer), savings rate.',
    ])
  })
})
