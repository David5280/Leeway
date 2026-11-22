// The emergency fund's card and the financial profile (with the check-in that
// the dashboard summary and the weekly email read) must say the same thing:
// what the fund holds, how many months of essentials that covers, and the
// essentials it is sized by. And the fund's pace comes from its accounts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import { balanceHistory, household } from './fixtures/emergency.js'
import { createTestContext, resetData } from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver.
let ctx: AppContext
const caller = actionCaller(() => ctx)
const { call } = caller
const TODAY = '2026-11-19'

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "America/Denver"}'`)
})

const owner = () => household(ctx.db, caller)

/**
 * Reads the fund's card, the profile and the check-in, checks they agree, and
 * returns what they agree on.
 */
async function agreed() {
  const card = (await call('get_emergency_fund'))!
  const profile = await getFinancialProfile(ctx.db, await getSettings(ctx.db), TODAY)
  const checkin = await call('get_checkin')
  const fund = profile.emergencyFund!
  expect(fund.savedCents).toBe(card.savedCents)
  expect(fund.monthsCovered).toBe(card.monthsCovered)
  expect(fund.monthlyEssentialsCents).toBe(card.essentials!.cents)
  expect(fund.essentialsFrom).toBe(card.essentials!.from)
  expect(checkin.savings!.emergencyFundMonths).toBe(card.monthsCovered)
  const goal = profile.goals.find((one) => one.id === card.goalId)
  if (goal) {
    expect(goal.currentCents).toBe(card.savedCents)
    expect(goal.targetCents).toBe(card.targetCents)
  }
  return { card, fund, goal }
}

describe('the emergency fund reads the same on its card and in the profile', () => {
  it('counts only the marked accounts in both', async () => {
    const { spare } = await owner()
    await call('start_emergency_fund')
    await call('change_emergency_fund', { accountIds: [spare] })
    const { card, fund, goal } = await agreed()
    expect(card.savedCents).toBe(50_000)
    // $500 of $2,600 a month: a tenth of a month, rounded down, and 19% of the first step.
    expect(fund.monthsCovered).toBe(0.1)
    expect(goal!.percent).toBe(19)
  })

  it('counts an overdrawn savings account as nothing in both, before and after starting', async () => {
    const { savings } = await owner()
    await ctx.db.query('UPDATE accounts SET balance_cents = -10000 WHERE id = $1', [savings])
    expect((await agreed()).card.savedCents).toBe(50_000)
    await call('start_emergency_fund')
    expect((await agreed()).card.savedCents).toBe(50_000)
  })

  it('sizes the fund from the bills in both when no spending reads as essential', async () => {
    await owner()
    const childcare = await call('create_category', { name: 'Child care' })
    // Child care is the only essential, and nothing was spent on it.
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [childcare.id] } })
    await call('create_bill', {
      name: 'Phone',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-11-01',
    })
    const { card } = await agreed()
    expect(card.essentials).toMatchObject({ cents: 150_000, from: 'bills' })
  })

  it('grows the target with essential spending in both', async () => {
    const { checking, rent } = await owner()
    await call('start_emergency_fund')
    await ctx.db.query(
      `INSERT INTO transactions (account_id, provider_transaction_id, date, name, amount_cents,
         category_id, category_source)
       VALUES ($1, 'rent-up-1', '2026-09-20', 'Rent up', 30000, $2, 'manual'),
              ($1, 'rent-up-2', '2026-10-20', 'Rent up', 30000, $2, 'manual')`,
      [checking, rent],
    )
    const { card } = await agreed()
    expect(card.targetCents).toBe(290_000)
    expect((await call('list_goals'))[0]!.targetCents).toBe(290_000)
  })

  it("stops the steps at the owner's own shorter target, which the profile aims for too", async () => {
    await owner()
    await call('update_settings', { savingsPlan: { emergencyFundMonths: 4 } })
    await call('start_emergency_fund')
    const three = await call('change_emergency_fund', { months: 3 })
    expect(three.next).toEqual({ months: 4, targetCents: 1_040_000 })
    const four = await call('change_emergency_fund', { months: 4 })
    expect(four.next).toBeNull()
    const { fund, card } = await agreed()
    expect(fund).toMatchObject({ targetMonths: 4, targetCents: card.targetCents })
  })

  it('reads a goal named as a fund, counted by hand, the same in both', async () => {
    await owner()
    await call('create_goal', { name: 'Rainy day', targetCents: 300_000, savedCents: 70_000 })
    expect((await agreed()).card).toMatchObject({ counts: 'hand', savedCents: 70_000 })
  })

  it('leaves the savings another goal follows out of both', async () => {
    const { savings } = await owner()
    await call('create_goal', { name: 'Trip', targetCents: 900_000, accountId: savings })
    expect((await agreed()).card.savedCents).toBe(50_000)
  })
})

describe("the fund's pace", () => {
  it('comes from the history of the accounts it counts', async () => {
    const { savings, spare } = await owner()
    // Savings rose from $1,000 to $3,000 this month; the spare $500 held still.
    await balanceHistory(ctx.db, savings, [
      ['2026-10-20', 100_000],
      ['2026-11-10', 300_000],
    ])
    await balanceHistory(ctx.db, spare, [['2026-10-01', 50_000]])
    const goal = await call('start_emergency_fund')
    await call('change_emergency_fund', { months: 6 })
    const planned = await call('update_goal', {
      id: goal.id,
      targetDate: '2027-04-30',
      setAside: true,
    })
    expect(planned.savedThisPeriodCents).toBe(200_000)
    expect(planned.recentPerPeriodCents).toBeGreaterThan(0)
    expect(planned.projectedDate).not.toBeNull()
    // What was saved this month comes off what the budget holds back for it.
    expect(planned.thisPeriodLeftCents).toBe((planned.perPeriodCents ?? 0) - 200_000)
  })

  it('counts an account first seen this month from its first balance, not as money saved', async () => {
    const { savings } = await owner()
    await balanceHistory(ctx.db, savings, [['2026-11-15', 300_000]])
    await call('start_emergency_fund')
    const [goal] = await call('list_goals')
    expect(goal).toMatchObject({ savedThisPeriodCents: 0, recentPerPeriodCents: 0 })
  })
})
