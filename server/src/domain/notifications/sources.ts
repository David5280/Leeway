// Where notifications come from: the alerts, budgets, bills, charges and
// banks Leeway already tracks, read once per check for the kinds turned on.

import type { AppContext } from '../../context.js'
import type { Db } from '../../db/pool.js'
import { addDays, todayIn, type IsoDate } from '../../lib/dates.js'
import { DAY_MS } from '../../lib/time.js'
import { formatCents } from '../../lib/money.js'
import { shortDate } from '../../lib/words.js'
import type { AccountAlert, AlertFormat } from '../accountAlerts.js'
import { listAccounts } from '../accounts.js'
import { listAlerts } from '../alerts.js'
import { listBills } from '../bills.js'
import { budgetSummary } from '../budgetReport.js'
import { listConnections } from '../connections.js'
import { getSettings, type Settings } from '../settings.js'
import type { NotificationSettings } from './settings.js'
import {
  accountCandidates,
  bankLoginCandidates,
  billCandidates,
  budgetCandidates,
  largeChargeCandidates,
  type Candidate,
  type LargeCharge,
} from './words.js'

/** A charge counts as news for this long after it reaches Leeway, and only if this recent. */
const LARGE_CHARGE_DAYS = 3

/**
 * Bank charges of at least `minCents`, recent by date and new to Leeway, so
 * linking a bank with old history notifies about none of it. Left out:
 * hidden accounts, imported or hidden transactions, and transfers between
 * the owner's own accounts.
 */
export async function recentLargeCharges(
  db: Db,
  minCents: number,
  today: IsoDate,
  now: Date,
): Promise<LargeCharge[]> {
  const { rows } = await db.query<LargeCharge>(
    `SELECT coalesce(t.pending_provider_transaction_id, t.provider_transaction_id) AS subject,
       t.account_id AS "accountId", coalesce(t.merchant_name, t.name) AS label,
       t.amount_cents::int AS "amountCents", to_char(t.date, 'YYYY-MM-DD') AS date
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.amount_cents >= $1 AND t.provider_transaction_id IS NOT NULL
       AND NOT t.excluded AND t.import_id IS NULL AND NOT a.hidden
       AND (c.kind IS NULL OR c.kind <> 'transfer')
       AND t.date >= $2 AND t.created_at >= $3
     ORDER BY t.date, t.created_at`,
    [
      minCents,
      addDays(today, -LARGE_CHARGE_DAYS),
      new Date(now.getTime() - LARGE_CHARGE_DAYS * DAY_MS),
    ],
  )
  return rows
}

/** The account alerts of the kinds turned on, as notifications. */
export function accountAlertCandidates(
  alerts: AccountAlert[],
  on: NotificationSettings['kinds'],
): Candidate[] {
  return accountCandidates(alerts.filter((alert) => on[alert.kind]))
}

function formatFor(settings: Settings): AlertFormat {
  return {
    money: (cents) => formatCents(cents, settings.currency, settings.locale),
    date: (date) => shortDate(date, settings.locale),
  }
}

/** Every notification the data calls for now, for the kinds turned on. */
export async function gatherCandidates(
  ctx: AppContext,
  choices: NotificationSettings,
): Promise<Candidate[]> {
  const { db } = ctx
  const now = ctx.now()
  const settings = await getSettings(db)
  const today = todayIn(settings.timeZone, now)
  const format = formatFor(settings)
  const on = choices.kinds
  const found: Candidate[][] = []

  if (on.overdrawn || on.over_limit || on.overdraft_fee || on.low_balance) {
    const alerts = await listAlerts(db, settings, today)
    found.push(accountAlertCandidates(alerts, on))
  }
  if (on.over_budget) {
    const budget = await budgetSummary(db, settings, now)
    found.push(
      budgetCandidates(budget.categories, budget.period.start, choices.overBudgetPercent, format),
    )
  }
  if (on.bill_due) {
    found.push(billCandidates(await listBills(db, today), choices.billDueDays, format))
  }
  if (on.large_transaction) {
    found.push(await largeCandidates(db, choices.largeTransactionCents, today, now, format))
  }
  if (on.bank_login) found.push(bankLoginCandidates(await listConnections(db)))
  return found.flat()
}

async function largeCandidates(
  db: Db,
  minCents: number,
  today: IsoDate,
  now: Date,
  format: AlertFormat,
): Promise<Candidate[]> {
  const [charges, accounts] = await Promise.all([
    recentLargeCharges(db, minCents, today, now),
    listAccounts(db),
  ])
  const names = new Map(accounts.map((account) => [account.id, account.name]))
  return largeChargeCandidates(charges, names, format)
}
