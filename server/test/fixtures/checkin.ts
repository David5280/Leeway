// Check-ins built by hand, for tests of the pure code that words them: the
// dashboard summary and the weekly email.

import type { AccountAlert } from '../../src/domain/accountAlerts.js'
import type { Checkin } from '../../src/domain/checkin.js'

export type CheckinGoal = Checkin['goals'][number]

/** A quiet mid-month: on budget, cash to spare, nothing to flag, nothing to compare. */
export function checkin(
  change: Partial<{ [K in keyof Checkin]: Partial<Checkin[K]> }> = {},
): Checkin {
  const base: Checkin = {
    today: '2026-11-17',
    attention: [],
    alerts: [],
    budget: {
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      daysLeft: 14,
      budgetedCents: 200000,
      spentCents: 80000,
      leftCents: 120000,
      setAsideCents: 0,
      leewayCents: 120000,
      safePerDayCents: 8571,
      projectedCents: 160000,
      projectedBudgetedCents: 160000,
      incomeCents: 300000,
      previousSpentToDateCents: 0,
    },
    cashFlow: {
      cashKnown: false,
      cashCents: 0,
      nextPayday: '2026-12-01',
      paydaySource: 'period_end',
      paydayEstimate: false,
      billsDueCents: 0,
      overdraftCents: 0,
      safeCents: 0,
      shortfallCents: 0,
      perDayCents: 0,
    },
    spendable: null,
    pay: { monthlyCents: null, estimate: false, cadence: null, paycheckCents: null, since: null },
    bills: { count: 0, monthlyCents: 0 },
    goals: [],
    debts: null,
    netWorth: { netWorthCents: 0, changeCents: 0, sinceDays: 30 },
    savings: null,
  }
  return {
    ...base,
    ...change,
    budget: { ...base.budget, ...change.budget },
    cashFlow: { ...base.cashFlow, ...change.cashFlow },
    netWorth: { ...base.netWorth, ...change.netWorth },
  } as Checkin
}

/** A savings goal a quarter of the way there, with no date. */
export function goal(name: string, fields: Partial<CheckinGoal> = {}): CheckinGoal {
  return {
    name,
    kind: 'savings',
    percent: 25,
    remainingCents: 10000,
    targetDate: null,
    perPeriodCents: null,
    monthlyNeededCents: null,
    projectedDate: null,
    onTrack: null,
    heldBackCents: 0,
    status: 'in_progress',
    balanceAsOf: null,
    ...fields,
  }
}

/** An overdrawn checking account, or another kind of alert with these fields. */
export function accountAlert(fields: Partial<AccountAlert> = {}): AccountAlert {
  return {
    kind: 'overdrawn',
    severity: 'urgent',
    accountId: 'acct-1',
    accountName: 'Everyday',
    amountCents: 4210,
    count: 1,
    date: null,
    message: 'Everyday is overdrawn by $42.10.',
    summary: 'Your Chase checking account is overdrawn by $42.10.',
    ...fields,
  }
}
