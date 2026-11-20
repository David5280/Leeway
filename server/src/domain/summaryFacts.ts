// What an AI writer is told for the dashboard summary: the check-in's numbers,
// already formatted as money and dates so nothing has to be converted from
// cents. Pure. Only totals, the heads-up list, account alerts with the
// account's display name, and bill and goal names: no account numbers or
// transactions.
//
// What can be spent now is one figure, spendNow, the same one the Overview's
// hero leads with: the lesser of the budget's room and what is safe to spend
// from checking before payday (spendable.ts). The cash in checking comes
// apart, as detail, so the writer never quotes a second, larger figure.

import type { IsoDate } from '../lib/dates.js'
import { periodWord, shortDate } from '../lib/words.js'
import type { Checkin } from './checkin.js'
import type { Settings } from './settings.js'
import { untilWords } from './spendable.js'
import { cashNote, urgentAlert } from './summaryText.js'

type Money = (cents: number) => string

type FactSettings = Pick<Settings, 'period' | 'locale'>

/** The one figure for what can be spent now, or null with neither a budget nor a checking balance. */
function spendNow(checkin: Checkin, money: Money, settings: FactSettings) {
  const { spendable, cashFlow } = checkin
  if (!spendable || (spendable.limitedBy === 'cash' && !cashFlow.cashKnown)) return null
  const byBudget = spendable.limitedBy === 'budget'
  return {
    amount: money(spendable.leadCents),
    perDay: money(spendable.perDayCents),
    limitedBy: spendable.limitedBy,
    meaning: byBudget
      ? 'left in the budgets after goals, which checking covers'
      : `safe to spend from checking ${untilWords(spendable, settings.locale)}, after bills`,
    // Null until a checking account has a balance: the cash is unknown, not zero.
    checkingBalanceKnown: cashFlow.cashKnown,
    note: cashFlow.cashKnown ? cashNote(checkin, money, settings.locale) : null,
  }
}

/** The cash behind the figure: supporting detail, never a second figure to spend. */
function cashInChecking({ cashFlow }: Checkin, money: Money, date: (iso: IsoDate) => string) {
  if (!cashFlow.cashKnown) return null
  return {
    safeToSpendBeforePayday: money(cashFlow.safeCents),
    payday: date(cashFlow.nextPayday),
    paydayIsAnEstimate: cashFlow.paydayEstimate,
    noPaydayFoundSoPeriodEndUsed: cashFlow.paydaySource === 'period_end',
    cashInChecking: money(cashFlow.cashCents),
    billsDueByPayday: money(cashFlow.billsDueCents),
    overdraftToBringBackToZero: money(cashFlow.overdraftCents),
    shortfall: cashFlow.shortfallCents > 0 ? money(cashFlow.shortfallCents) : null,
  }
}

/** Savings at a glance, or null without savings accounts: with only a pension there is no balance to speak of. */
function savingsFacts({ savings }: Checkin, money: Money, date: (iso: IsoDate) => string) {
  if (!savings?.hasSavingsAccounts) return null
  return {
    total: money(savings.totalCents),
    changeThisMonth:
      savings.changeThisMonthCents === null ? null : money(savings.changeThisMonthCents),
    changeMeasuredSince: savings.changeSince && date(savings.changeSince),
    emergencyFundMonthsCovered: savings.emergencyFundMonths,
    emergencyFundTargetMonths: savings.emergencyFundTargetMonths,
    // No savings rate or pension figures: the bank sees only part of what is saved,
    // and the summary needs neither to say how things are going.
  }
}

/** The check-in as facts for an AI writer. */
export function summaryFacts(checkin: Checkin, settings: FactSettings, money: Money) {
  const { budget } = checkin
  const date = (iso: IsoDate) => shortDate(iso, settings.locale)
  return {
    today: date(checkin.today),
    period: {
      kind: periodWord(settings.period.kind),
      ends: date(budget.periodEnd),
      daysLeftCountingToday: budget.daysLeft + 1,
      budgeted: money(budget.budgetedCents),
      spent: money(budget.spentCents),
      left: money(budget.leftCents),
      setAsideForGoals: money(budget.setAsideCents),
      budgetRoomAfterGoals: money(budget.leewayCents),
      budgetedSpendingByPeriodEndAtThisPace: money(budget.projectedBudgetedCents),
      spentByThisPointLastPeriod: money(budget.previousSpentToDateCents),
    },
    spendNow: spendNow(checkin, money, settings),
    cashInChecking: cashInChecking(checkin, money, date),
    // Pay is paychecks from the employers paying now only; money from people,
    // refunds and transfers in are not pay.
    typicalMonthlyPay:
      checkin.pay.monthlyCents === null
        ? null
        : {
            amount: money(checkin.pay.monthlyCents),
            estimatedFromOnePaycheck: checkin.pay.estimate,
          },
    // Account alerts have their own list below, so the heads-up list leaves them out.
    headsUp: checkin.attention
      .filter((item) => item.topic !== 'account')
      .map(({ priority, message }) => ({ priority, message })),
    accountAlerts: checkin.alerts.map((alert) => alert.summary),
    // An overdrawn account or a card over its limit outranks the budget, so the
    // writer is handed the headline rather than trusted to lead with it.
    fixedHeadline: urgentAlert(checkin)?.summary ?? null,
    goals: checkin.goals.map((g) => ({
      name: g.name,
      kind: g.kind,
      percentDone: g.percent,
      stillToGo: money(g.remainingCents),
      targetDate: g.targetDate && date(g.targetDate),
      setAsideEachPeriod: g.perPeriodCents === null ? null : money(g.perPeriodCents),
      onTrack: g.onTrack,
      status: g.status,
    })),
    debts: checkin.debts && {
      owed: money(checkin.debts.owedCents),
      debtFreeDate: checkin.debts.debtFreeDate,
    },
    netWorthChangeLast30Days: money(checkin.netWorth.changeCents),
    savingsAndInvestments: savingsFacts(checkin, money, date),
  }
}

export type SummaryFacts = ReturnType<typeof summaryFacts>
