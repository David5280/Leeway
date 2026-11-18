// Fixtures for the Plan screen, built with the server's own math where there is some.

import { billInputSchema, scheduleOf } from '../../../server/src/domain/bills'
import { goalInputSchema, progressOf } from '../../../server/src/domain/goals'
import { planPayoff, type Debt } from '../../../server/src/domain/payoff'
import { Route, Routes } from 'react-router-dom'
import type { Account, Bill, CashFlow, DebtPlans, Goal, RecurringSeries } from '../api/client'
import { Plan } from '../pages/Plan'
import { account as baseAccount, fakeServer, renderSignedIn, type Handlers } from './fake'

export const TODAY = '2026-11-17'

/** A bill as list_bills returns it on November 17th. */
export function bill(
  fields: Partial<Bill> & { name: string; amountCents: number; anchorDate: string },
): Bill {
  const { id, lastPaidDate, lastPaidCents, ...input } = fields
  return scheduleOf(
    {
      // Test category ids are not UUIDs, so the category is checked apart from the schema.
      ...billInputSchema.parse({ cadence: 'month', ...input, categoryId: null }),
      categoryId: input.categoryId ?? null,
      id: id ?? `bill-${fields.name.toLowerCase()}`,
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
    suggestedKind: 'subscription',
    ...fields,
  }
}

/** A goal as list_goals returns it on November 17th. */
export function goal(fields: { name: string; targetCents: number } & Partial<Goal>): Goal {
  const { id, accountName, accountBalanceCents, ...input } = fields
  return progressOf(
    {
      // Test account ids are not UUIDs, so the account is checked apart from the schema.
      ...goalInputSchema.parse({ ...input, accountId: null }),
      accountId: input.accountId ?? null,
      id: id ?? `goal-${fields.name.toLowerCase().replaceAll(' ', '-')}`,
      accountName: accountName ?? null,
      accountBalanceCents: accountBalanceCents ?? null,
    },
    TODAY,
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
    expectedPayCents: null,
    daysUntilPayday: 10,
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
    leftAfterBillsCents: 144000,
    perDayCents: 14400,
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
