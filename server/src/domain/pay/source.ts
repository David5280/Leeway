// Reads the deposits pay is worked out from, and the cadence the owner gave
// (a saved paystub's, or a paycheck budget period's), for current.ts.

import type { Db } from '../../db/pool.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { latestPaystub } from '../paystubs/paystubs.js'
import { freshPaystub } from '../savings/payrollMonths.js'
import { periodConfig, type Settings } from '../settings.js'
import { currentPay, type CurrentPay } from './current.js'
import type { Deposit } from './deposits.js'
import { PAY_CADENCE } from './payday.js'

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

/** The cadence the owner gave: a recent paystub's, else a paycheck budget period's. */
async function givenCadence(db: Db, settings: Settings, today: IsoDate): Promise<Cadence | null> {
  const paystub = freshPaystub(await latestPaystub(db), today)
  if (paystub?.payCadence) return paystub.payCadence
  const config = periodConfig(settings)
  return config.kind === 'paycheck' ? PAY_CADENCE[config.frequency] : null
}

/** The owner's pay now, read fresh: see current.ts. */
export async function readCurrentPay(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<CurrentPay> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const deposits = await readDeposits(db, today)
  return currentPay(deposits, today, await givenCadence(db, settings, today))
}
