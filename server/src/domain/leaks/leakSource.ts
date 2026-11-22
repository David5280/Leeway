// Reads what the leak checks need, finds the leaks (duplicates.ts,
// priceRises.ts) and words them as account alerts (leakAlerts.ts). Only
// charges a merchant made are read (merchantCharges.ts), so a payment to a
// person, and so their name, never reaches an alert.

import type { Db } from '../../db/pool.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import type { AccountAlert, AlertFormat } from '../accountAlerts.js'
import { accountMasks } from '../accounts.js'
import { countedSql } from '../counted.js'
import type { StoredTransaction } from '../recurring.js'
import type { AccountMasks } from '../safeName.js'
import { merchantDisplayName } from '../transactionName.js'
import { untrackedSeries, type UntrackedSeries } from '../untrackedRecurring.js'
import {
  DUPLICATE_HISTORY_DAYS,
  findDoubleCharges,
  findDuplicates,
  type ChargeLine,
  type DuplicateCharge,
} from './duplicates.js'
import { duplicateAlert, priceRiseAlert } from './leakAlerts.js'
import { isMerchantCharge, type CodedLine } from './merchantCharges.js'
import { findPriceRises, type PriceRise, type RepeatingCharge } from './priceRises.js'

/** Every leak found now, before it is worded. */
export interface Leaks {
  duplicates: DuplicateCharge[]
  /** Every charge made more than once still news, refunded ones too: what tells a bill paid twice. */
  doubles: DuplicateCharge[]
  rises: PriceRise[]
  /** Every account's mask, so no merchant name shows one. */
  masks: AccountMasks
}

/** A charge line without the bank's codes, once isMerchantCharge has read them. */
function withoutCodes({
  providerCategoryPrimary: _primary,
  providerCategoryDetailed: _detailed,
  ...line
}: CodedLine): ChargeLine {
  return line
}

/**
 * Posted charges and refunds of the last DUPLICATE_HISTORY_DAYS, today
 * included, on any account, that a merchant charged (merchantCharges.ts).
 * Transfers between the owner's own accounts and charges the owner left out
 * of totals are aside. Pending lines are left out: one and the posted line it
 * became are a single charge.
 */
async function postedCharges(db: Db, today: IsoDate): Promise<ChargeLine[]> {
  const { rows } = await db.query<CodedLine>(
    `SELECT t.id, t.account_id AS "accountId", t.date, t.name,
       t.merchant_name AS "merchantName", t.amount_cents AS "amountCents",
       t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed"
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE NOT t.pending AND NOT t.excluded AND t.date > $1 AND t.date <= $2
       AND ${countedSql()}
     ORDER BY t.date, t.id`,
    [addDays(today, -DUPLICATE_HISTORY_DAYS), today],
  )
  return rows.filter(isMerchantCharge).map(withoutCodes)
}

/** A stored charge as the leak checks read it, with the bank's codes kept for isMerchantCharge. */
function codedLine(charge: StoredTransaction): CodedLine {
  return {
    id: charge.id,
    // Every stored transaction has an account; only detection's input type leaves it optional.
    accountId: charge.accountId!,
    date: charge.date,
    name: charge.name,
    merchantName: charge.merchantName,
    amountCents: charge.amountCents,
    providerCategoryPrimary: charge.providerCategoryPrimary,
    providerCategoryDetailed: charge.providerCategoryDetailed,
  }
}

/**
 * Repeating money out that a merchant charges (merchantCharges.ts), each as
 * the rise check reads it. A series with any line a merchant did not charge
 * (a payment to a person, cash, a check, a transfer or a bank fee) is left
 * out whole: its amount is the owner's choice, not a price, and its name may
 * be a person's.
 */
export function repeatingCharges(found: UntrackedSeries[]): RepeatingCharge[] {
  return found
    .filter(({ series }) => series.direction === 'out')
    .map(({ series, charges }) => ({ series, lines: charges.map(codedLine) }))
    .filter(({ lines }) => lines.every(isMerchantCharge))
    .map(({ series, lines }) => ({
      name: series.name,
      cadence: series.cadence,
      charges: lines.map(withoutCodes),
    }))
}

/**
 * Every leak there is now. `series` is the untracked series read, given when
 * the caller has already started it for the suggestions too, so the history
 * behind both is read once.
 */
export async function listLeaks(
  db: Db,
  today: IsoDate,
  series: Promise<UntrackedSeries[]> = untrackedSeries(db, today),
): Promise<Leaks> {
  const [charges, found, masks] = await Promise.all([
    postedCharges(db, today),
    series,
    accountMasks(db),
  ])
  return {
    duplicates: findDuplicates(charges, today),
    doubles: findDoubleCharges(charges, today),
    rises: findPriceRises(repeatingCharges(found), today),
    masks,
  }
}

/** Reads the leaks once, on the first call, and hands every later call the same read. */
export type LeakReader = () => Promise<Leaks>

/**
 * A LeakReader for one request or one notifier run, so the alerts it lists
 * more than once (each reads about 400 days of history) share a single read.
 */
export function leakReader(db: Db, today: IsoDate): LeakReader {
  let read: Promise<Leaks> | undefined
  return () => (read ??= listLeaks(db, today))
}

/**
 * The alerts for leaks on these accounts (keyed by id, with the names the
 * app shows), duplicates first. A leak on any other account is left out.
 */
export function leakAlerts(
  { duplicates, rises, masks }: Pick<Leaks, 'duplicates' | 'rises' | 'masks'>,
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
