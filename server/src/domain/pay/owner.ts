// Saving the owner's word on their pay: a one-tap confirmation of what the
// paychecks show, their own amount, cadence and next payday, or going back
// to the paychecks as found. A paycheck budget period moves with each
// (period.ts), so budgets and the payday agree.

import type { Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import type { PeriodConfig } from '../../lib/periods.js'
import { periodConfig, saveSettings, settingsSchema, type Settings } from '../settings.js'
import type { PayCadence } from './cadence.js'
import {
  employerIdOf,
  NO_PAY_SETTINGS,
  payerSaltOf,
  replacedIndex,
  type PayOverride,
} from './ownPay.js'
import { PAYDAY_RANGE_DAYS } from './paydayRange.js'
import { paycheckPeriod, periodInStep } from './period.js'
import { readDetectedPay, readFoundPay } from './source.js'
import { periodOfPay, readPayView, type PayView } from './view.js'

/**
 * Saves new pay settings and budget period, then reads the view back. The
 * salt payer ids are keyed with is saved too, so an id saved keeps its job.
 */
async function savePay(
  db: Db,
  settings: Settings,
  change: { pay: Omit<Settings['pay'], 'payerSalt'>; period: PeriodConfig },
  today: IsoDate,
): Promise<PayView> {
  const pay = { ...change.pay, payerSalt: payerSaltOf(settings.pay) }
  const next = settingsSchema.parse({ ...settings, ...change, pay })
  await saveSettings(db, next)
  return readPayView(db, next, today)
}

/**
 * Says the pay found is right: the main employer and how often it pays.
 * It stops being an estimate, and any pay the owner entered is cleared,
 * since they have said the paychecks have it right.
 */
export async function confirmPay(db: Db, settings: Settings, today: IsoDate): Promise<PayView> {
  const detected = await readDetectedPay(db, today)
  const main = detected.employer
  if (!main) {
    throw new AppError(
      'invalid_input',
      'Leeway has not found a paycheck to confirm yet. Enter your pay instead.',
    )
  }
  const confirmed = {
    payerId: employerIdOf(main, settings.pay),
    cadence: main.cadence as PayCadence,
  }
  return savePay(
    db,
    settings,
    {
      pay: { confirmed, override: null },
      period: periodInStep(periodConfig(settings), periodOfPay(detected, null)),
    },
    today,
  )
}

/** Whether a payday is within a year of today either way. */
function nearToday(payday: IsoDate, today: IsoDate): boolean {
  return payday >= addDays(today, -PAYDAY_RANGE_DAYS) && payday <= addDays(today, PAYDAY_RANGE_DAYS)
}

/**
 * Goes back to the pay the paychecks show, as found: the owner's own pay
 * and any confirmation are cleared, and a paycheck budget period moves back
 * to the paychecks' schedule (or stays, when they show none yet).
 */
async function backToPaychecks(db: Db, settings: Settings, today: IsoDate): Promise<PayView> {
  const aligned = periodOfPay(await readDetectedPay(db, today), null)
  const period = periodInStep(periodConfig(settings), aligned)
  return savePay(db, settings, { pay: NO_PAY_SETTINGS, period }, today)
}

/**
 * The id of the job the owner's pay stands in for: the one it already does
 * while that job still pays, else (none entered yet, or its job stopped)
 * the main job; null with none found.
 */
async function replacedPayerId(db: Db, settings: Settings, today: IsoDate): Promise<string | null> {
  const { employers } = await readFoundPay(db, settings, today)
  const index = replacedIndex(employers, settings.pay)
  const job = employers[index >= 0 ? index : 0]
  return job ? employerIdOf(job, settings.pay) : null
}

/**
 * Saves the owner's own pay, used in place of what the paychecks show for
 * the job it stands in for, or with null goes back to the paychecks. Their
 * payday has to be within a year of today, so a typo in the year does not
 * plan around it.
 */
export async function setPay(
  db: Db,
  settings: Settings,
  override: PayOverride | null,
  today: IsoDate,
): Promise<PayView> {
  if (override === null) return backToPaychecks(db, settings, today)
  if (!nearToday(override.nextPayday, today)) {
    throw new AppError('invalid_input', 'Pick a payday within a year of today')
  }
  const payerId = await replacedPayerId(db, settings, today)
  const aligned = paycheckPeriod(override.cadence, override.nextPayday)
  return savePay(
    db,
    settings,
    {
      pay: { ...settings.pay, override: { ...override, payerId } },
      period: periodInStep(periodConfig(settings), aligned),
    },
    today,
  )
}
