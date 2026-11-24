// A money check-in: one read of everything a coach needs, plus what needs attention.

import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import { formatCents } from '../lib/money.js'
import { listAccounts } from './accounts.js'
import { listAlerts } from './alerts.js'
import { listBills } from './bills.js'
import { budgetReport } from './budgetReport.js'
import { withRoom } from './budgetRoom.js'
import { getCashFlow } from './cashFlow.js'
import { attentionItems, type AttentionItem } from './coach.js'
import { listConnections } from './connections.js'
import { debtPlans } from './debts.js'
import { fundSaved } from './emergencyPlan.js'
import { essentialsOf } from './goalFunds.js'
import { goalReading } from './goalProgress.js'
import { listGoals } from './goals.js'
import { listLeaks } from './leaks/leakSource.js'
import { readPaystubPayroll } from './paystubs/applied.js'
import { getNetWorth } from './netWorth.js'
import { typicalMonth } from './profile/income.js'
import { savingsMeasures, type SavingsMeasures } from './profile/profile.js'
import {
  pensionMonthlyTotals,
  type Pension,
  type PensionMonthlyTotals,
} from './retirement/pensions.js'
import { pensionsOf } from './retirement/pensionStore.js'
import { bankSeenRate, countedNote, countsPayroll, type SavingsRate } from './savings/rate.js'
import { getSavingsGlance, type SavingsGlance } from './savings/report.js'
import type { Settings } from './settings.js'
import { suggestionsOf, untrackedSeries } from './untrackedRecurring.js'

/** How far back the net worth change is measured. */
export const NET_WORTH_DAYS = 30

export async function getCheckin(db: Db, settings: Settings, now: Date, today: IsoDate) {
  // One read of the repeating charges serves both the suggestions and the leak alerts.
  const series = untrackedSeries(db, today)
  const reading = goalReading(settings, today)
  const [
    report,
    cashFlow,
    bills,
    goals,
    plans,
    connections,
    recurring,
    worth,
    alerts,
    { accounts, savings, pensions },
    { monthly, pay },
    paystub,
  ] = await Promise.all([
    budgetReport(db, settings, now),
    getCashFlow(db, settings, today),
    listBills(db, today),
    listGoals(db, reading),
    debtPlans(db, 0, today),
    listConnections(db),
    series.then(suggestionsOf),
    getNetWorth(db, today, NET_WORTH_DAYS),
    listAlerts(db, settings, today, [], { leaks: () => listLeaks(db, today, series) }),
    // Only what the savings glance needs beyond the reads above, not the whole profile.
    listAccounts(db, false).then(async (accounts) => ({
      accounts,
      savings: await getSavingsGlance(db, settings, today, accounts),
      pensions: await pensionsOf(db, accounts),
    })),
    typicalMonth(db, settings, today),
    readPaystubPayroll(db, today),
  ])
  const budget = withRoom(report, cashFlow, settings)
  // Read once with the goals, so the fund's goal, its card and this check-in agree.
  const { essentials } = await essentialsOf(db, reading)
  const pensionPay = pensionMonthlyTotals(pensions, pay.cadence)
  const billsMonthlyCents = bills.reduce((sum, b) => sum + b.monthlyCents, 0)
  const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)
  const attention: AttentionItem[] = attentionItems(
    {
      accountAlerts: alerts,
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
    /** Overdrawn accounts, cards over their limit, overdraft fees and low balances (see list_alerts). */
    alerts,
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
    /** Safe to spend until payday (see get_cash_flow): the one figure for what can be spent now. */
    cashFlow: {
      cashKnown: cashFlow.cashKnown,
      cashCents: cashFlow.cashCents,
      nextPayday: cashFlow.nextPayday,
      paydaySource: cashFlow.paydaySource,
      paydayEstimate: cashFlow.paydayEstimate,
      billsDueCents: cashFlow.billsDueCents,
      overdraftCents: cashFlow.overdraftCents,
      safeCents: cashFlow.safeCents,
      shortfallCents: cashFlow.shortfallCents,
      perDayCents: cashFlow.perDayCents,
    },
    /** The budget's room held to what is safe to spend, and the one line that says when they differ. */
    spendable: budget.spendable,
    /** Pay from the employers paying now: an estimate while any one's cadence is unconfirmed. */
    pay: {
      monthlyCents: monthly.incomeCents,
      estimate: monthly.incomeEstimated,
      cadence: pay.cadence,
      paycheckCents: pay.typicalPayCents,
      since: pay.since,
    },
    bills: { count: bills.length, monthlyCents: billsMonthlyCents },
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
      balanceAsOf: g.balanceAsOf,
      /** True for a trip budget's goal, which is spent on the trip rather than bought. */
      forTrip: g.trip !== null,
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
    savings: savingsGlance(
      savings,
      { pensions, pensionPay },
      savingsMeasures({
        fundSavedCents: fundSaved(goals, accounts, settings.currency, savings.cashCents !== null),
        contributions: savings.contributions,
        pensionMonthlyCents: pensionPay.memberCents,
        planMonthlyCents: paystub.planMonthlyCents,
        stalePlan: paystub.stalePlan,
        matchMonthlyCents: paystub.matchMonthlyCents,
        monthly,
        essentials,
        settings,
        today,
      }),
    ),
  }
}

/** The savings rate as the check-in reports it, beside what it counts. */
function rateGlance(savingsRate: SavingsRate | null) {
  return {
    /**
     * The savings rate as far as the bank sees it: payroll deductions are never
     * in it, so the key says so wherever it is read. Null when pay or saving is
     * unknown, never a guess of zero.
     */
    bankSeenSavingsRatePercent: bankSeenRate(savingsRate)?.percent ?? null,
    /**
     * The rate with the payroll deductions Leeway knows (a pension the owner
     * entered, a 401(k), 457 or 403(b) and any employer match a recent paystub shows);
     * null when none are known.
     */
    payrollIncludedSavingsRatePercent:
      savingsRate && countsPayroll(savingsRate) ? savingsRate.percent : null,
    /** What the rate counts, in the words the owner sees beside it; null without a rate. */
    savingsRateNote: savingsRate ? countedNote(savingsRate) : null,
  }
}

/** The pensions the check-in reports on, and what they take from pay. */
interface PensionGlanceInput {
  pensions: Pension[]
  pensionPay: PensionMonthlyTotals
}

/**
 * Whether a pension is recorded, and what it takes from pay a month and the
 * employer adds, where the owner entered enough to say. A recorded pension is
 * retirement saving, whatever goes into a 401(k) or IRA. Null with none.
 */
function pensionGlance({ pensions, pensionPay }: PensionGlanceInput) {
  if (pensions.length === 0) return null
  return {
    count: pensions.length,
    monthlyContributionCents: pensionPay.memberCents,
    employerMonthlyCents: pensionPay.employerCents,
  }
}

/**
 * Savings at a glance: the total and how it moved this month, the emergency
 * fund, the savings rate and any pension, worked out as the financial profile
 * does. Null with neither savings nor a pension.
 */
function savingsGlance(
  savings: SavingsGlance,
  pension: PensionGlanceInput,
  { emergencyFund, savingsRate }: SavingsMeasures,
) {
  if (!savings.hasSavings && pension.pensions.length === 0) return null
  return {
    /** Whether any savings, retirement or investment account is counted; false with only a pension. */
    hasSavingsAccounts: savings.hasSavings,
    totalCents: savings.totalCents,
    /** Measured from the first of the month, or from the first day of history when later. */
    changeThisMonthCents: savings.month?.changeCents ?? null,
    changeSince: savings.month?.since ?? null,
    emergencyFundMonths: emergencyFund?.monthsCovered ?? null,
    emergencyFundTargetMonths: emergencyFund?.targetMonths ?? null,
    ...rateGlance(savingsRate),
    pension: pensionGlance(pension),
  }
}

export type Checkin = Awaited<ReturnType<typeof getCheckin>>
