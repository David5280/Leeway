// Fixtures for the Plan screen, built with the server's own math where there is some.

import { billInputSchema, scheduleOf } from '../../../server/src/domain/bills'
import type { GoalProgressFacts } from '../../../server/src/domain/goalPlan'
import { goalInputSchema, goalOf } from '../../../server/src/domain/goals'
import { planPayoff, type Debt } from '../../../server/src/domain/payoff'
import { retirementView } from '../../../server/src/domain/profile/views'
import type { RetirementPatch } from '../../../server/src/domain/retirement/assumptions'
import type { RetirementInput } from '../../../server/src/domain/retirement/plan'
import { formatWholeCents } from '../../../server/src/lib/money'
import { Route, Routes } from 'react-router-dom'
import type { Account, Bill, CashFlow, DebtPlans, Goal, RecurringSeries } from '../api/client'
import type { RetirementView } from '../pages/plan/retirement/fields'
import { Plan } from '../pages/Plan'
import { account as baseAccount, fakeServer, renderSignedIn, type Handlers } from './fake'
import { retirementProfile } from './profile'

export const TODAY = '2026-11-17'

/** A bill as list_bills returns it on November 17th. */
export function bill(
  fields: Partial<Bill> & { name: string; amountCents: number; anchorDate: string },
): Bill {
  const { id, lastPaidDate, lastPaidCents, reads, accountId, ...input } = fields
  return scheduleOf(
    {
      // Test category ids are not UUIDs, so the category is checked apart from the schema.
      ...billInputSchema.parse({ cadence: 'month', ...input, categoryId: null }),
      categoryId: input.categoryId ?? null,
      id: id ?? `bill-${fields.name.toLowerCase()}`,
      reads: reads ?? 'bank_text',
      accountId: accountId ?? null,
      lastPaidDate: lastPaidDate ?? null,
      lastPaidCents: lastPaidCents ?? null,
    },
    TODAY,
  )
}

export function series(fields: Partial<RecurringSeries> & { name: string }): RecurringSeries {
  return {
    key: fields.name.toLowerCase(),
    direction: 'out',
    cadence: 'month',
    typicalAmountCents: 1549,
    amountVaries: false,
    count: 4,
    lastDate: '2026-10-20',
    nextDate: '2026-11-20',
    categoryId: null,
    accountId: null,
    suggestedKind: 'subscription',
    ...fields,
  }
}

/** No contributions lately: the history of a goal nobody has put money toward. */
export const NO_PROGRESS: GoalProgressFacts = {
  savedThisPeriodCents: 0,
  recentSavedCents: 0,
  recentDays: 90,
}

/**
 * A goal as list_goals returns it on November 17th, budgeting by the month,
 * from the server's own math. `facts` stands in for its recent history.
 */
export function goal(
  fields: { name: string; targetCents: number } & Partial<Goal>,
  facts: GoalProgressFacts = NO_PROGRESS,
): Goal {
  const { id, accountName, accountBalanceCents, balanceAsOf, createdOn, ...input } = fields
  return goalOf(
    {
      // Test account ids are not UUIDs, so the account is checked apart from the schema.
      ...goalInputSchema.parse({ ...input, accountId: null }),
      accountId: input.accountId ?? null,
      id: id ?? `goal-${fields.name.toLowerCase().replaceAll(' ', '-')}`,
      accountName: accountName ?? null,
      accountBalanceCents: accountBalanceCents ?? null,
      balanceAsOf: balanceAsOf ?? null,
      createdOn: createdOn ?? '2026-09-01',
    },
    facts,
    { today: TODAY, period: { kind: 'monthly', startDay: 1 } },
  )
}

/** An account as the Plan screen tests expect: $2,500.00 unless told otherwise. */
export function account(fields: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return baseAccount({ balanceCents: 250000, ...fields })
}

export function cashFlow(fields: Partial<CashFlow> = {}): CashFlow {
  return {
    today: TODAY,
    nextPayday: '2026-11-27',
    paydaySource: 'pay_period',
    paydayEstimate: false,
    expectedPayCents: null,
    daysUntilPayday: 10,
    cashKnown: true,
    cashCents: 150000,
    billsDue: [
      {
        billId: 'bill-phone',
        name: 'Phone',
        dueDate: '2026-11-20',
        amountCents: 6000,
        overdue: false,
      },
    ],
    billsDueCents: 6000,
    overdraftCents: 0,
    safeCents: 144000,
    shortfallCents: 0,
    perDayCents: 14400,
    // The Plan screen reads the cash alone; the budget's lead is the Overview's.
    spendable: null,
    ...fields,
  }
}

/** Plans for these debts from the server's payoff math, debt-free dates counted from December. */
export function debtPlans(
  debts: Debt[],
  extraCents = 0,
  needsDetails: DebtPlans['needsDetails'] = [],
): DebtPlans {
  const withDate = (plan: ReturnType<typeof planPayoff>) => ({
    ...plan,
    debtFreeDate:
      plan.months === null
        ? null
        : new Date(Date.UTC(2026, 10 + plan.months, 1)).toISOString().slice(0, 10),
  })
  const minimums = debts.reduce((sum, d) => sum + (d.minimumCents ?? 0), 0)
  return {
    debts: debts.map((d) => ({
      ...d,
      type: 'credit',
      minimumEstimated: d.minimumCents === null,
    })),
    needsDetails,
    minimumsCents: minimums,
    avalanche: withDate(planPayoff(debts, extraCents, 'avalanche')),
    snowball: withDate(planPayoff(debts, extraCents, 'snowball')),
    minimumsOnly: withDate(planPayoff(debts, 0, 'minimums')),
  }
}

/** The server for the Plan screen: cash flow is always there, the rest per test. */
export function planServer(handlers: Handlers, routes: Record<string, () => Response> = {}) {
  return fakeServer({ get_cash_flow: () => cashFlow(), ...handlers }, routes)
}

/** The Plan screen at an address, with its routes, as the app has them. */
export function renderPlan(path = '/plan') {
  return renderSignedIn(
    <Routes>
      <Route path="/plan" element={<Plan />} />
      <Route path="/plan/:section" element={<Plan />} />
    </Routes>,
    { route: path },
  )
}

/** A retirement view as project_retirement returns it, from the server's own math and words. */
export function retirementOf(
  fields: Partial<RetirementInput> = {},
  assumptions: RetirementPatch = {},
): RetirementView {
  const profile = retirementProfile(fields, assumptions)
  const money = (cents: number) => formatWholeCents(cents, 'USD', 'en-US')
  return {
    asOf: TODAY,
    whatIf: false,
    ...retirementView(profile, { money, locale: 'en-US' }),
  }
}
