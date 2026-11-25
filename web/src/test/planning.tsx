// Fixtures for the planning screens (Payday, Bills, Goals and Wealth's pages),
// built with the server's own math where there is some.

import { belowZero, type SavingsSource } from '../../../server/src/domain/belowZero'
import { billInputSchema, scheduleOf } from '../../../server/src/domain/bills'
import type { GoalProgressFacts } from '../../../server/src/domain/goalPlan'
import { goalOf } from '../../../server/src/domain/goalProgress'
import { goalInputSchema } from '../../../server/src/domain/goals'
import { planPayoff, type Debt } from '../../../server/src/domain/payoff'
import { retirementView } from '../../../server/src/domain/profile/views'
import type { RetirementPatch } from '../../../server/src/domain/retirement/assumptions'
import type { RetirementInput } from '../../../server/src/domain/retirement/plan'
import { formatWholeCents } from '../../../server/src/lib/money'
import { Route, Routes } from 'react-router-dom'
import type {
  Account,
  Bill,
  CashFlow,
  DebtPlans,
  Goal,
  RecurringSeries,
  Settings,
} from '../api/client'
import type { RetirementView } from '../pages/plan/retirement/fields'
import { BillsPage } from '../pages/Bills'
import { DebtsPage } from '../pages/Debts'
import { Goals } from '../pages/Goals'
import { IdleCashPage } from '../pages/IdleCash'
import { Payday } from '../pages/Payday'
import { RetirementPage } from '../pages/Retirement'
import { SixWeeksPage } from '../pages/SixWeeks'
import { Wealth } from '../pages/Wealth'
import { YourPayPage } from '../pages/YourPay'
import { paths, SCREEN_ROUTES } from '../routes'
import { account as baseAccount, fakeServer, renderSignedIn, type Handlers } from './fake'
import { fundsView } from './funds'
import { noPay } from './pay'
import { NO_PAYSTUB_IN_USE } from './paystub'
import { playbookOf } from './playbook'
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
  const {
    id,
    accountName,
    accountBalanceCents,
    balanceAsOf,
    createdOn,
    emergencyMonths,
    followedAccountIds,
    trip,
    ...input
  } = fields
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
      emergencyMonths: emergencyMonths ?? null,
      followedAccountIds: followedAccountIds ?? null,
      trip: trip ?? null,
    },
    facts,
    { today: TODAY, period: { kind: 'monthly', startDay: 1 } },
  )
}

/** An account as the Plan screen tests expect: $2,500.00 unless told otherwise. */
export function account(fields: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return baseAccount({ balanceCents: 250000, ...fields })
}

/**
 * get_cash_flow's answer, with its below zero warning worked out by the
 * server's own math from these figures and savings, unless a test sets it.
 */
export function cashFlow(fields: Partial<CashFlow> = {}, savings: SavingsSource[] = []): CashFlow {
  const flow: Omit<CashFlow, 'belowZero'> = {
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
  return {
    ...flow,
    belowZero: 'belowZero' in fields ? fields.belowZero! : belowZero(flow, savings),
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

/**
 * The server for the planning screens (Payday, Goals, Wealth and the pages
 * under them): cash flow and an everyday payday playbook are always there,
 * with no emergency fund to offer, no goal order, nothing entered by hand, no
 * calendar, no trips and no accounts' extras unless a test says otherwise;
 * the rest per test.
 */
export function planServer(handlers: Handlers, routes: Record<string, () => Response> = {}) {
  return fakeServer(
    {
      get_cash_flow: () => cashFlow(),
      get_pay: () => noPay,
      get_emergency_fund: () => null,
      get_goal_order: () => ({ monthlyCents: 0, source: 'none', goals: [] }),
      list_owned_and_owed: () => ({ owned: [], owed: [], ownedCents: 0, owedCents: 0 }),
      list_trips: () => [],
      list_sinking_funds: () => fundsView(),
      get_payday_playbook: () => playbookOf(),
      calendar_status: () => ({ connected: false }),
      get_forecast: () => ({ connected: false, today: TODAY, weeks: [], note: null }),
      get_paystub_use: () => NO_PAYSTUB_IN_USE,
      list_recent_balances: () => [],
      list_alerts: () => [],
      ...handlers,
    },
    routes,
  )
}

/**
 * The planning screens at an address, with their routes as the app has them,
 * and the settings given: Payday with Bills, Your pay and the six weeks, Goals, and Wealth with Debts,
 * Retirement and cash that could earn more.
 */
export function renderPlanning(path: string = paths.payday(), settings?: Settings) {
  return renderSignedIn(
    <Routes>
      <Route path={SCREEN_ROUTES.payday} element={<Payday />} />
      <Route path={SCREEN_ROUTES.bills} element={<BillsPage />} />
      <Route path={SCREEN_ROUTES.pay} element={<YourPayPage />} />
      <Route path={SCREEN_ROUTES.sixWeeks} element={<SixWeeksPage />} />
      <Route path={SCREEN_ROUTES.goals} element={<Goals />} />
      <Route path={SCREEN_ROUTES.wealth} element={<Wealth />} />
      <Route path={SCREEN_ROUTES.debts} element={<DebtsPage />} />
      <Route path={SCREEN_ROUTES.retirement} element={<RetirementPage />} />
      <Route path={SCREEN_ROUTES.idleCash} element={<IdleCashPage />} />
    </Routes>,
    { route: path, settings },
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
