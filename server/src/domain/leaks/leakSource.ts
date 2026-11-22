// Reads what the leak checks need, finds the leaks (duplicates.ts,
// priceRises.ts) and words them as account alerts (leakAlerts.ts).

import type { Db } from '../../db/pool.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import { isOverdraftFee, type AccountAlert, type AlertFormat } from '../accountAlerts.js'
import { accountMasks } from '../accounts.js'
import { countedSql } from '../counted.js'
import { untrackedSeries } from '../recurring.js'
import type { AccountMasks } from '../safeName.js'
import { merchantDisplayName } from '../transactionName.js'
import { findDuplicates, HABIT_DAYS, type ChargeLine, type DuplicateCharge } from './duplicates.js'
import { duplicateAlert, priceRiseAlert } from './leakAlerts.js'
import { findPriceRises, type PriceRise } from './priceRises.js'

/** Every leak found now, before it is worded. */
export interface Leaks {
  duplicates: DuplicateCharge[]
  rises: PriceRise[]
  /** Every account's mask, so no merchant name shows one. */
  masks: AccountMasks
}

/**
 * Posted charges and refunds of the last HABIT_DAYS, today included, on any
 * account, transfers between the owner's own accounts and charges the owner
 * left out of totals aside. Pending lines are left out: one and the posted
 * line it became are a single charge. Overdraft fees are left out too: two
 * on a day are two shortfalls, which the fee alert already counts.
 */
async function postedCharges(db: Db, today: IsoDate): Promise<ChargeLine[]> {
  const { rows } = await db.query<ChargeLine & { categoryDetailed: string | null }>(
    `SELECT t.id, t.account_id AS "accountId", t.date, t.name,
       t.merchant_name AS "merchantName", t.amount_cents AS "amountCents",
       t.provider_category_detailed AS "categoryDetailed"
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE NOT t.pending AND NOT t.excluded AND t.date > $1 AND t.date <= $2
       AND ${countedSql()}
     ORDER BY t.date, t.id`,
    [addDays(today, -HABIT_DAYS), today],
  )
  return rows
    .filter((line) => !isOverdraftFee(line))
    .map(({ categoryDetailed: _category, ...line }) => line)
}

/** Repeating money out that no bill tracks, each as the rise check reads it. */
async function repeatingCharges(db: Db, today: IsoDate) {
  const found = await untrackedSeries(db, today)
  return found
    .filter(({ series }) => series.direction === 'out')
    .map(({ series, charges }) => ({
      name: series.name,
      charges: charges.map(({ id, accountId, date, name, merchantName, amountCents }) => ({
        id,
        accountId: accountId!,
        date,
        name,
        merchantName,
        amountCents,
      })),
    }))
}

/** Every leak there is now. */
export async function listLeaks(db: Db, today: IsoDate): Promise<Leaks> {
  const [charges, repeating, masks] = await Promise.all([
    postedCharges(db, today),
    repeatingCharges(db, today),
    accountMasks(db),
  ])
  return {
    duplicates: findDuplicates(charges, today),
    rises: findPriceRises(repeating, today),
    masks,
  }
}

/**
 * The alerts for leaks on these accounts (keyed by id, with the names the
 * app shows), duplicates first. A leak on any other account is left out.
 */
export function leakAlerts(
  { duplicates, rises, masks }: Leaks,
  accountNames: Map<string, string>,
  format: AlertFormat,
): AccountAlert[] {
  const named = (accountId: string) => accountNames.get(accountId)
  const doubles = duplicates.flatMap((duplicate) => {
    const accountName = named(duplicate.accountId)
    if (accountName === undefined) return []
    const merchant = merchantDisplayName(duplicate.charges.at(-1)!, { masks })
    return [duplicateAlert(duplicate, { accountName, merchant }, format)]
  })
  const risen = rises.flatMap((rise) => {
    const accountName = named(rise.charge.accountId)
    return accountName === undefined ? [] : [priceRiseAlert(rise, accountName, format)]
  })
  return [...doubles, ...risen]
}
