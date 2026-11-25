// A cheap fingerprint of the owner's financial data, which changes whenever
// any of it does: a sync, an import, or an edit to a transaction, account,
// bill, goal, pay, paystub or setting. Chat keeps its snapshot of the whole
// picture until this changes (chat/snapshotCache.ts).
//
// How it works: every row Postgres writes carries `xmin`, the id of the
// transaction that wrote it. An insert or update gives the row a newer xmin,
// so a table's highest xmin moves; a delete lowers its row count. The pair
// per table therefore moves on any committed write, without reading a single
// column or keeping a timestamp on every table. Tables Chat writes on every
// question (its messages, AI usage) are left out, so asking alone never
// changes it.

import type { Db } from '../db/pool.js'

/** Every table whose rows feed the check-in or the financial profile. */
export const FINANCIAL_TABLES = [
  'accounts',
  'alert_hides',
  'balance_history',
  'bills',
  'categories',
  'connections',
  'dismissed_recurring',
  'goal_accounts',
  'goal_contributions',
  'goals',
  'held_charges',
  'imports',
  'paystub_details',
  'paystubs',
  'pension_plans',
  'rules',
  'settings',
  'sinking_fund_dismissals',
  'sinking_funds',
  'transactions',
  'trip_budgets',
] as const

// One row per table: its count and newest writer. The names are the fixed
// list above, never input, so building the SQL from them is safe.
const FINGERPRINT_SQL = FINANCIAL_TABLES.map(
  (table) =>
    `SELECT '${table}' AS t, count(*) AS n, coalesce(max(xmin::text::bigint), 0) AS x FROM ${table}`,
).join(' UNION ALL ')

/** A short string that is the same while the financial data is, and differs once it changes. */
export async function dataFingerprint(db: Db): Promise<string> {
  const { rows } = await db.query<{ t: string; n: string; x: string }>(FINGERPRINT_SQL)
  return rows.map((row) => `${row.t}:${row.n}:${row.x}`).join(',')
}
