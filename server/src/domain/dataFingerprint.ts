// A cheap fingerprint of the owner's financial data, which changes whenever
// any of it does: a sync, an import, or an edit to a transaction, account,
// bill, goal, pay, paystub or setting. Chat keeps its snapshot of the whole
// picture until this changes (chat/snapshotCache.ts).
//
// How it works: every row Postgres writes carries `xmin`, the id of the
// transaction that wrote it. Per table, the row count and the sum of every
// row's xmin are taken: an insert or delete changes the count, and an update
// gives its rows a new xmin, which changes the sum. A sum, not the newest
// xmin, because writers can commit out of id order (a long sync with an
// older id committing after a quick edit) and ids wrap around, so the
// newest would miss them. Tables Chat writes on every question (its
// messages, AI usage) are left out, so asking alone never changes it. Each
// question scans these tables once, which is cheap at one person's scale.

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

// One row per table: its count and the sum of its writers' ids. The names are the fixed
// list above, never input, so building the SQL from them is safe.
const FINGERPRINT_SQL = FINANCIAL_TABLES.map(
  (table) =>
    `SELECT '${table}' AS t, count(*) AS n, coalesce(sum(xmin::text::bigint), 0) AS x FROM ${table}`,
).join(' UNION ALL ')

/** A short string that is the same while the financial data is, and differs once it changes. */
export async function dataFingerprint(db: Db): Promise<string> {
  const { rows } = await db.query<{ t: string; n: string; x: string }>(FINGERPRINT_SQL)
  return rows.map((row) => `${row.t}:${row.n}:${row.x}`).join(',')
}
