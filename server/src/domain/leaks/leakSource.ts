// Reads what the leak checks need, finds the leaks (duplicates.ts,
// priceRises.ts) and words them as account alerts (leakAlerts.ts). Only
// charges a merchant made are read (merchantCharges.ts), so a payment to a
// person, and so their name, never reaches an alert. Even then an alert names
// the merchant only when the bank's data says it is one (leakNames.ts).

import type { Db } from '../../db/pool.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import type { AccountAlert, AlertFormat } from '../accountAlerts.js'
import { accountMasks } from '../accounts.js'
import { countedSql } from '../counted.js'
import type { StoredTransaction } from '../recurring.js'
import { untrackedSeries, type UntrackedSeries } from '../untrackedRecurring.js'
import {
  DUPLICATE_HISTORY_DAYS,
  findDoubleCharges,
  findDuplicates,
  type ChargeLine,
  type DuplicateCharge,
} from './duplicates.js'
import { duplicateAlert, priceRiseAlert } from './leakAlerts.js'
import { leakNames } from './leakNames.js'
import { isMerchantCharge, type CodedLine } from './merchantCharges.js'
import { findPriceRises, type PriceRise, type RepeatingCharge } from './priceRises.js'

/** Every leak found now, before it is worded. */
export interface Leaks {
  duplicates: DuplicateCharge[]
  /** Every charge made more than once still news, refunded ones too: what tells a bill paid twice. */
  doubles: DuplicateCharge[]
  rises: PriceRise[]
  /**
   * The name an alert may show for each charge read, by the charge's id, or
   * null when it should name no one (leakNames.ts). Read while the bank's
   * codes are still on the line, before the leak checks drop them.
   */
  names: Map<string, string | null>
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
async function postedCharges(db: Db, today: IsoDate): Promise<CodedLine[]> {
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
  return rows.filter(isMerchantCharge)
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

/** A repeating series of money out, its lines with the bank's codes still on. */
interface CodedSeries {
  cadence: RepeatingCharge['cadence']
  lines: CodedLine[]
}

/**
 * Repeating money out that a merchant charges (merchantCharges.ts). A series
 * with any line a merchant did not charge (a payment to a person, cash, a
 * check, a transfer or a bank fee) is left out whole: its amount is the
 * owner's choice, not a price, and its name may be a person's.
 */
function codedSeries(found: UntrackedSeries[]): CodedSeries[] {
  return found
    .filter(({ series }) => series.direction === 'out')
    .map(({ series, charges }) => ({ cadence: series.cadence, lines: charges.map(codedLine) }))
    .filter(({ lines }) => lines.every(isMerchantCharge))
}

/** A coded series as the rise check reads it, once the codes are read. */
const asRepeating = ({ cadence, lines }: CodedSeries): RepeatingCharge => ({
  cadence,
  charges: lines.map(withoutCodes),
})

/** Repeating money out that a merchant charges (codedSeries), each as the rise check reads it. */
export function repeatingCharges(found: UntrackedSeries[]): RepeatingCharge[] {
  return codedSeries(found).map(asRepeating)
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
  const [coded, found, masks] = await Promise.all([
    postedCharges(db, today),
    series,
    accountMasks(db),
  ])
  const repeating = codedSeries(found)
  const charges = coded.map(withoutCodes)
  return {
    duplicates: findDuplicates(charges, today),
    doubles: findDoubleCharges(charges, today),
    rises: findPriceRises(repeating.map(asRepeating), today),
    names: leakNames([...coded, ...repeating.flatMap(({ lines }) => lines)], masks),
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
 * Each alert names the merchant of the charge it points at when `names` has
 * one for it, and no one otherwise.
 */
export function leakAlerts(
  { duplicates, rises, names }: Pick<Leaks, 'duplicates' | 'rises' | 'names'>,
  accountNames: Map<string, string>,
  format: AlertFormat,
): AccountAlert[] {
  const merchantOf = (chargeId: string) => names.get(chargeId) ?? null
  const doubles = duplicates.flatMap((duplicate) => {
    const accountName = accountNames.get(duplicate.accountId)
    if (accountName === undefined) return []
    const merchant = merchantOf(duplicate.charges.at(-1)!.id)
    return [duplicateAlert(duplicate, { accountName, merchant }, format)]
  })
  const risen = rises.flatMap((rise) => {
    const accountName = accountNames.get(rise.charge.accountId)
    if (accountName === undefined) return []
    return [priceRiseAlert(rise, { accountName, merchant: merchantOf(rise.charge.id) }, format)]
  })
  return [...doubles, ...risen]
}
