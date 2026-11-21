// Saving the owner's word on their pay: a one-tap confirmation of what the
// paychecks show, or their own amount, cadence and next payday. A paycheck
// budget period moves with it (period.ts), so budgets and the payday agree.

import type { Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import type { PeriodConfig } from '../../lib/periods.js'
import { periodConfig, saveSettings, settingsSchema, type Settings } from '../settings.js'
import type { PayCadence } from './cadence.js'
import { payerKeyOf, type PayOverride } from './given.js'
import { paycheckPeriod, periodInStep } from './period.js'
import { readDetectedPay } from './source.js'
import { readPayView, type PayView } from './view.js'

/** How far from today a payday the owner gives may be: a year either way. */
const PAYDAY_RANGE_DAYS = 366

/** Saves new pay settings and budget period, then reads the view back. */
async function savePay(
  db: Db,
  settings: Settings,
  change: { pay: Settings['pay']; period: PeriodConfig },
  today: IsoDate,
): Promise<PayView> {
  const next = settingsSchema.parse({ ...settings, ...change })
  await saveSettings(db, next)
  return readPayView(db, next, today)
}

/**
 * Says the pay found is right: the main employer and how often it pays.
 * It stops being an estimate, and any pay the owner entered is cleared,
 * since they have said the paychecks have it right.
 */
export async function confirmPay(db: Db, settings: Settings, today: IsoDate): Promise<PayView> {
  const detected = await readDetectedPay(db, settings, today)
  const main = detected.employer
  if (!main) {
    throw new AppError(
      'invalid_input',
      'Leeway has not found a paycheck to confirm yet. Enter your pay instead.',
    )
  }
  const cadence = main.cadence as PayCadence
  const payerKey = payerKeyOf(main)
  const paydays = detected.paychecks.filter((p) => p.payerKey === payerKey).map((p) => p.date)
  const aligned = paycheckPeriod(cadence, main.lastPaycheck, paydays)
  return savePay(
    db,
    settings,
    {
      pay: { confirmed: { payerKey, cadence }, override: null },
      period: periodInStep(periodConfig(settings), aligned),
    },
    today,
  )
}

/** Whether a payday is within a year of today either way. */
function nearToday(payday: IsoDate, today: IsoDate): boolean {
  return payday >= addDays(today, -PAYDAY_RANGE_DAYS) && payday <= addDays(today, PAYDAY_RANGE_DAYS)
}

/**
 * Saves the owner's own pay, used in place of what the paychecks show, or
 * with null goes back to the paychecks (the budget period stays as it is).
 * Their payday has to be within a year of today, so a typo in the year does
 * not plan around it.
 */
export async function setPay(
  db: Db,
  settings: Settings,
  override: PayOverride | null,
  today: IsoDate,
): Promise<PayView> {
  const current = periodConfig(settings)
  if (override === null) {
    return savePay(db, settings, { pay: { ...settings.pay, override }, period: current }, today)
  }
  if (!nearToday(override.nextPayday, today)) {
    throw new AppError('invalid_input', 'Pick a payday within a year of today')
  }
  const aligned = paycheckPeriod(override.cadence, override.nextPayday)
  return savePay(
    db,
    settings,
    { pay: { ...settings.pay, override }, period: periodInStep(current, aligned) },
    today,
  )
}
