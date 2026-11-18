// A money check-in: one read of everything a coach needs, plus what needs attention.

import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import { formatCents } from '../lib/money.js'
import { listBills } from './bills.js'
import { budgetReport } from './budgetReport.js'
import { getCashFlow } from './cashFlow.js'
import { attentionItems, type AttentionItem } from './coach.js'
import { listConnections } from './connections.js'
import { debtPlans } from './debts.js'
import { listGoals } from './goals.js'
import { getNetWorth } from './netWorth.js'
import { untrackedRecurring } from './recurring.js'
import { periodConfig, type Settings } from './settings.js'

/** How far back the net worth change is measured. */
const NET_WORTH_DAYS = 30

export async function getCheckin(db: Db, settings: Settings, now: Date, today: IsoDate) {
  const [budget, cashFlow, bills, goals, plans, connections, recurring, worth] = await Promise.all([
    budgetReport(db, settings, now),
    getCashFlow(db, settings, today),
    listBills(db, today),
    listGoals(db, { today, period: periodConfig(settings) }),
    debtPlans(db, 0, today),
    listConnections(db),
    untrackedRecurring(db, today),
    getNetWorth(db, today, NET_WORTH_DAYS),
  ])
  const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)
  const attention: AttentionItem[] = attentionItems(
    {
      budget,
      cashFlow,
      bills,
      goals,
      debtGaps: plans.needsDetails,
      connections,
      untrackedRecurringCount: recurring.length,
    },
    money,
  )
  const { totals, period } = budget
  // The earliest point in the window is what net worth was when it began.
  const startWorth = worth.history[0]?.netWorthCents ?? worth.netWorthCents

  return {
    today,
    attention,
    budget: {
      periodStart: period.start,
      periodEnd: period.end,
      daysLeft: period.daysLeft,
      budgetedCents: totals.budgetedCents,
      spentCents: totals.spentCents,
      leftCents: totals.leftCents,
      setAsideCents: totals.setAsideCents,
      leewayCents: totals.leewayCents,
      safePerDayCents: totals.safePerDayCents,
      projectedCents: totals.projectedCents,
      projectedBudgetedCents: totals.projectedBudgetedCents,
      incomeCents: totals.incomeCents,
      previousSpentToDateCents: budget.previous.spentToDateCents,
    },
    cashFlow: {
      cashCents: cashFlow.cashCents,
      nextPayday: cashFlow.nextPayday,
      paydaySource: cashFlow.paydaySource,
      billsDueCents: cashFlow.billsDueCents,
      leftAfterBillsCents: cashFlow.leftAfterBillsCents,
      perDayCents: cashFlow.perDayCents,
    },
    bills: {
      count: bills.length,
      monthlyCents: bills.reduce((sum, b) => sum + b.monthlyCents, 0),
    },
    goals: goals.map((g) => ({
      name: g.name,
      kind: g.kind,
      percent: g.percent,
      remainingCents: g.remainingCents,
      targetDate: g.targetDate,
      perPeriodCents: g.perPeriodCents,
      monthlyNeededCents: g.monthlyNeededCents,
      projectedDate: g.projectedDate,
      onTrack: g.onTrack,
      heldBackCents: g.heldBackCents,
      status: g.status,
    })),
    debts:
      plans.debts.length === 0
        ? null
        : {
            owedCents: plans.debts.reduce((sum, d) => sum + d.balanceCents, 0),
            minimumsCents: plans.minimumsCents,
            debtFreeDate: plans.avalanche.debtFreeDate,
            totalInterestCents: plans.avalanche.totalInterestCents,
          },
    netWorth: {
      netWorthCents: worth.netWorthCents,
      changeCents: worth.netWorthCents - startWorth,
      sinceDays: NET_WORTH_DAYS,
    },
  }
}

export type Checkin = Awaited<ReturnType<typeof getCheckin>>
