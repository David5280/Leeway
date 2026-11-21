// What is left over each budget period to save toward a purchase: a typical
// month's pay from the employers paying now, less typical spending (both from
// profile/income.ts), in the budget period's terms. when_can_i_afford reads it.
//
// It used to be filed income less spending over the last three periods, so
// money from family through Venmo and a tax refund, filed as income, read as
// a surplus that was never there.

import type { Db } from '../db/pool.js'
import { cadenceOf, convertCadence } from '../lib/periods.js'
import { currentPeriod } from './budgetReport.js'
import { typicalMonth, type MonthlyAverages } from './profile/income.js'
import { periodConfig, type Settings } from './settings.js'

/**
 * A typical month's pay less spending, as a budget period's share. Null
 * while no employer is paying, or with too little history to call a month
 * typical: there is nothing honest to go on.
 */
export function surplusPerPeriod(
  monthly: Pick<MonthlyAverages, 'incomeCents' | 'spendingCents'>,
  settings: Settings,
): number | null {
  if (monthly.incomeCents === null || monthly.spendingCents === null) return null
  const perMonth = monthly.incomeCents - monthly.spendingCents
  return convertCadence(perMonth, 'month', cadenceOf(periodConfig(settings)))
}

/** The surplus a typical budget period leaves, read as of now, and whether its pay is an estimate. */
export async function typicalSurplus(
  db: Db,
  settings: Settings,
  now: Date,
): Promise<{ cents: number | null; estimate: boolean }> {
  const { monthly } = await typicalMonth(db, settings, currentPeriod(settings, now).today)
  return { cents: surplusPerPeriod(monthly, settings), estimate: monthly.incomeEstimated }
}
