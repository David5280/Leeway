// Where the money went in a period, by merchant, biggest first
// (top_merchants), with what a model is shown instead of a merchant whose
// name could be a person's (modelLabels.ts).

import type { Db } from '../db/pool.js'
import { accountMasks } from './accounts.js'
import { currentPeriod } from './budgetReport.js'
import { spendingSql } from './counted.js'
import { GENERIC_NAME } from './merchantName.js'
import { neutralLabel, type LabelSubject } from './modelLabels.js'
import { shopsIn } from './peopleContext.js'
import type { Settings } from './settings.js'
import { merchantDisplayName } from './transactionName.js'

export interface MerchantTotal {
  merchant: string
  spentCents: number
  count: number
  /**
   * Set when any spending in the total could be paying a person, as through
   * an app or by bank transfer: what a model is shown instead (modelLabels.ts).
   */
  modelLabel?: string
}

type MerchantRow = LabelSubject & { spentCents: number; count: number }

// What a total's rows are shown as when they are labelled differently ("Check"
// paid by check to a cleaner and by check with no code).
const MIXED_LABEL = 'Purchase or payment'

/** The label of a total with one more row, which keeps it or, when they differ, MIXED_LABEL. */
function withLabel(total: MerchantTotal, label: string | undefined): MerchantTotal {
  if (!label || total.modelLabel === label) return total
  return { ...total, modelLabel: total.modelLabel ? MIXED_LABEL : label }
}

/**
 * Where the money went in a period, by merchant, biggest first. Refunds count
 * against a merchant. Merchants are named as everywhere else (see
 * transactionName.ts), so "STARBUCKS #123" and "STARBUCKS #456" add up as one
 * Starbucks. Lines with nothing readable in them are left out: under their
 * shared "Bank transaction" they would add up unrelated spending as if it
 * were one merchant. A total any of whose rows a model is shown by a label
 * carries that label (withLabel), so the owner sees one total and a model
 * never sees the name.
 */
export async function topMerchants(
  db: Db,
  settings: Settings,
  now: Date,
  offset: number,
  limit: number,
): Promise<MerchantTotal[]> {
  const { period } = currentPeriod(settings, now, offset)
  const { rows } = await db.query<MerchantRow>(
    `SELECT t.name, t.merchant_name AS "merchantName",
            t.provider_category_primary AS "providerCategoryPrimary",
            t.provider_category_detailed AS "providerCategoryDetailed",
            t.merchant_entity_id AS "merchantEntityId",
            (t.provider_transaction_id IS NULL AND t.import_id IS NULL) AS "handEntered",
            sum(t.amount_cents)::bigint AS "spentCents", count(*)::int AS count
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= $1 AND t.date < $2
       AND NOT t.excluded AND NOT a.hidden AND ($3 OR NOT t.pending)
       AND ${spendingSql()}
     GROUP BY 1, 2, 3, 4, 5, 6`,
    [period.start, period.end, settings.includePending],
  )
  // Merchant names go to assistants and the AI writer, so they show no account number.
  const masks = await accountMasks(db)
  const spent = rows.map((row) => ({ ...row, amountCents: row.spentCents }))
  // A row typed in by hand joins a total of the same name, so a shop in it is one seen here.
  const shops = shopsIn(spent)
  const byMerchant = new Map<string, MerchantTotal>()
  for (const row of spent) {
    const merchant = merchantDisplayName(row, { masks })
    const label = neutralLabel(row, shops)?.label
    const total = withLabel(
      byMerchant.get(merchant) ?? { merchant, spentCents: 0, count: 0 },
      label,
    )
    byMerchant.set(merchant, {
      ...total,
      spentCents: total.spentCents + row.spentCents,
      count: total.count + row.count,
    })
  }
  byMerchant.delete(GENERIC_NAME)
  return [...byMerchant.values()]
    .filter((total) => total.spentCents > 0)
    .sort((a, b) => b.spentCents - a.spentCents || a.merchant.localeCompare(b.merchant))
    .slice(0, limit)
}
