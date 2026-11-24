// Reads the deposits pay is worked out from, and the cadence a saved paystub
// gives, for current.ts; then lays a confirmed paystub's take-home over its
// job's paycheck (paystubPay.ts), and the owner's own word on their pay over
// that (ownPay.ts): a confirmation reads the employer it names their way,
// and their own pay stands in for a job's, the paystub's included. So the
// owner's own pay wins, then a confirmed paystub, then the deposits alone.
// The Payday screen reads the pay found (readFoundPay), as the bank shows it.
//
// A paycheck budget period is never read as how the paychecks come: it moves
// with the pay the owner confirms or enters (owner.ts), so reading it back
// would turn their own word into what Leeway found, and keep it there after
// they go back to the paychecks.

import type { Db } from '../../db/pool.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import { paystubPayOf, readLatestDetail } from '../paystubs/applied.js'
import { latestPaystub } from '../paystubs/paystubs.js'
import { freshPaystub } from '../savings/payrollMonths.js'
import type { Settings } from '../settings.js'
import { currentPay, type CurrentPay } from './current.js'
import type { Deposit } from './deposits.js'
import type { GivenCadence } from './given.js'
import { readAsConfirmed, withOwnersPay } from './ownPay.js'
import { withPaystubPay } from './paystubPay.js'

/** How far back pay is read: long enough to see a job end and a long gap before the next. */
export const PAY_HISTORY_DAYS = 550

/** Posted money in on the accounts that count, oldest first. */
export async function readDeposits(db: Db, today: IsoDate): Promise<Deposit[]> {
  const { rows } = await db.query<Deposit>(
    `SELECT t.id, t.account_id AS "accountId", t.date, t.name, t.merchant_name AS "merchantName",
       t.amount_cents::int AS "amountCents", t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType",
       c.kind AS "categoryKind"
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.amount_cents < 0 AND NOT t.pending AND NOT t.excluded AND NOT a.hidden
       AND t.date BETWEEN $1 AND $2
     ORDER BY t.date, t.id`,
    [addDays(today, -PAY_HISTORY_DAYS), today],
  )
  return rows
}

/** The cadence a recent paystub gives, with what says which job it is from (given.ts). */
async function paystubCadence(db: Db, today: IsoDate): Promise<GivenCadence | null> {
  const paystub = freshPaystub(await latestPaystub(db), today)
  if (!paystub?.payCadence) return null
  const { payCadence: cadence, payDate, employerName } = paystub
  return { cadence, paystub: { payDate, employerName } }
}

/** The pay the paychecks show, before the owner's word on it: see current.ts. */
export async function readDetectedPay(db: Db, today: IsoDate): Promise<CurrentPay> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const deposits = await readDeposits(db, today)
  return currentPay(deposits, today, await paystubCadence(db, today))
}

/**
 * The pay the paychecks show, with the employer the owner confirmed read
 * their way while their confirmation still matches (ownPay.ts).
 */
export async function readFoundPay(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<CurrentPay> {
  const deposits = await readDeposits(db, today)
  const paystub = await paystubCadence(db, today)
  const detected = currentPay(deposits, today, paystub)
  return readAsConfirmed(deposits, detected, settings.pay, today, paystub)
}

/**
 * The owner's pay now, read fresh: a confirmed paystub's take-home laid over
 * its job (paystubPay.ts), then the owner's own word over that (ownPay.ts).
 */
export async function readCurrentPay(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<CurrentPay> {
  const found = await readFoundPay(db, settings, today)
  const detail = await readLatestDetail(db, today)
  const paystub = detail ? paystubPayOf(detail) : null
  return withOwnersPay(withPaystubPay(found, paystub), settings.pay, today)
}
