// The owner's debts, read from credit card and loan accounts, and payoff
// plans for them. Planning only: nothing here makes a payment.

import type { Db } from '../db/pool.js'
import { addMonths, type IsoDate } from '../lib/dates.js'
import { accountNames } from './accounts.js'
import { planPayoff, startingMinimums, type Debt, type PayoffPlan } from './payoff.js'

export interface DebtSummary extends Debt {
  type: 'credit' | 'loan'
  /** True when the minimum is unknown and the usual card formula stands in for it. */
  minimumEstimated: boolean
}

export interface DebtGap {
  id: string
  name: string
  /** What to fill in on the account before this debt can be planned. */
  missing: ('aprPercent' | 'minimumPaymentCents')[]
}

export interface DebtPlans {
  debts: DebtSummary[]
  /** Debts left out of the plans until their terms are filled in. */
  needsDetails: DebtGap[]
  /** What the minimums come to this month. */
  minimumsCents: number
  avalanche: PayoffPlan & { debtFreeDate: IsoDate | null }
  snowball: PayoffPlan & { debtFreeDate: IsoDate | null }
  minimumsOnly: PayoffPlan & { debtFreeDate: IsoDate | null }
}

interface DebtRow {
  id: string
  name: string
  type: 'credit' | 'loan'
  balanceCents: number
  aprBps: number | null
  minimumCents: number | null
}

/** What a debt needs before it can be planned. A card's minimum can be estimated; a loan's cannot. */
function missingTerms(row: DebtRow): DebtGap['missing'] {
  const missing: DebtGap['missing'] = []
  if (row.aprBps === null) missing.push('aprPercent')
  if (row.type === 'loan' && row.minimumCents === null) missing.push('minimumPaymentCents')
  return missing
}

/**
 * Counted cards and loans with a balance owed, split into plannable debts and
 * gaps. One the bank no longer shares has no current balance to plan from.
 */
export async function listDebts(db: Db): Promise<Pick<DebtPlans, 'debts' | 'needsDetails'>> {
  const { rows } = await db.query<Omit<DebtRow, 'name'>>(
    `SELECT a.id, a.type, a.balance_cents AS "balanceCents",
       a.apr_bps AS "aprBps", a.minimum_payment_cents AS "minimumCents"
     FROM accounts a
     WHERE a.type IN ('credit', 'loan') AND NOT a.hidden AND a.unshared_at IS NULL
       AND a.balance_cents > 0`,
  )
  // Sorted by the name shown, which is worked out here rather than in SQL.
  const names = await accountNames(db)
  const named = rows
    .map((row): DebtRow => ({ ...row, name: names.get(row.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const debts: DebtSummary[] = []
  const needsDetails: DebtGap[] = []
  for (const row of named) {
    const missing = missingTerms(row)
    if (missing.length > 0) needsDetails.push({ id: row.id, name: row.name, missing })
    else debts.push({ ...row, aprBps: row.aprBps!, minimumEstimated: row.minimumCents === null })
  }
  return { debts, needsDetails }
}

/** The month a plan finishes in, counted from this month. */
function debtFreeDate(plan: PayoffPlan, today: IsoDate): IsoDate | null {
  return plan.months === null ? null : `${addMonths(today, plan.months).slice(0, 7)}-01`
}

/** Avalanche, snowball and minimums-only plans, paying `extraCents` a month over the minimums. */
export async function debtPlans(db: Db, extraCents: number, today: IsoDate): Promise<DebtPlans> {
  const { debts, needsDetails } = await listDebts(db)
  const plan = (strategy: 'avalanche' | 'snowball' | 'minimums') => {
    const result = planPayoff(debts, extraCents, strategy)
    return { ...result, debtFreeDate: debtFreeDate(result, today) }
  }
  return {
    debts,
    needsDetails,
    minimumsCents: startingMinimums(debts),
    avalanche: plan('avalanche'),
    snowball: plan('snowball'),
    minimumsOnly: plan('minimums'),
  }
}
