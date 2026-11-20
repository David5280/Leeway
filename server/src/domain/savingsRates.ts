// The savings rate month by month, counted exactly as the profile's rate is
// (savings/rate.ts): money the bank labeled as moved to savings or
// investments, plus the pension contributions the owner entered, out of each
// month's pay. A month with no pay seen, or nothing saved that Leeway can
// see, has no rate rather than a rate of zero, since payroll deductions such
// as a 401(k) never reach the bank. There is no target until the owner sets
// one, so no month ever reads as falling short of one they did not choose.

import type { Db } from '../db/pool.js'
import { listAccounts } from './accounts.js'
import { currentPeriod } from './budgetReport.js'
import { monthlyTotals, type MonthTotals } from './monthlyTotals.js'
import { paySchedule } from './profile/income.js'
import { pensionMonthlyTotals } from './retirement/pensions.js'
import { pensionsOf } from './retirement/pensionStore.js'
import { savingsTransferDestination, type TransferCandidate } from './savings/contributions.js'
import { PENSION_COUNTED, savingsRate, SEEN_AT_BANK, type SavingSource } from './savings/rate.js'
import { splitAccounts } from './savings/report.js'
import { transferCandidates } from './savings/store.js'
import type { Settings } from './settings.js'

export interface MonthRate {
  /** First day of the month. */
  start: string
  /** The month still running, so its figures are only so far. */
  current: boolean
  /** Whole percent of pay saved, or null when it cannot be known. */
  percent: number | null
  savedCents: number
  /** Take-home pay, plus pension contributions once they are counted. */
  payCents: number
}

export interface SavingsRates {
  months: MonthRate[]
  /** The rate the owner chose to aim for, or null when they set none. */
  targetPercent: number | null
  /** What was counted, said beside the chart: payroll deductions are not, except a pension entered. */
  note: string
}

/** Net money moved to savings and investments in each month, never below zero. */
function savedByMonth(months: MonthTotals[], transfers: TransferCandidate[]): number[] {
  return months.map((month) => {
    const net = transfers
      .filter((tx) => tx.date >= month.start && tx.date <= month.end)
      .filter((tx) => savingsTransferDestination(tx.providerCategoryDetailed) !== null)
      .reduce((sum, tx) => sum + tx.amountCents, 0)
    // Taking out more than went in is not negative saving Leeway can stand behind.
    return Math.max(0, net)
  })
}

/** Each month's rate from its pay, what moved to savings, and the pension's monthly contribution. */
export function monthRates(
  months: MonthTotals[],
  transfers: TransferCandidate[],
  pensionMonthlyCents: number | null,
): MonthRate[] {
  const saved = savedByMonth(months, transfers)
  return months.map((month, i) => {
    const sources: SavingSource[] = [
      {
        label: 'Transfers to savings and investments',
        monthlyCents: saved[i]!,
        beforePaycheck: false,
      },
    ]
    if (pensionMonthlyCents) {
      sources.push({
        label: 'Pension contributions',
        monthlyCents: pensionMonthlyCents,
        beforePaycheck: true,
      })
    }
    const rate = savingsRate(month.incomeCents, sources)
    return {
      start: month.start,
      current: month.current,
      percent: rate?.percent ?? null,
      savedCents: rate?.savedMonthlyCents ?? saved[i]!,
      payCents: rate?.payMonthlyCents ?? Math.max(0, month.incomeCents),
    }
  })
}

/** The savings rate for each of the last `count` calendar months, oldest first. */
export async function savingsRates(
  db: Db,
  settings: Settings,
  now: Date,
  count: number,
): Promise<SavingsRates> {
  const { today } = currentPeriod(settings, now)
  // One at a time: db may be a transaction's client, which runs one query at once.
  const months = await monthlyTotals(db, settings, now, count)
  const accounts = await listAccounts(db, false)
  const transfers = await transferCandidates(
    db,
    splitAccounts(accounts).everydayIds,
    settings.currency,
    today,
  )
  const pensions = await pensionsOf(db, accounts)
  const pay = await paySchedule(db, settings, today)
  const pension = pensionMonthlyTotals(pensions, pay.cadence).memberCents
  const rates = monthRates(months, transfers, pension)
  return {
    months: rates,
    targetPercent: settings.savingsPlan.savingsRateTargetPercent,
    note: pension ? PENSION_COUNTED : SEEN_AT_BANK,
  }
}
