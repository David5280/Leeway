// Savings goals: a target amount, an optional date, and progress toward it.
// A goal can be general savings or a purchase (an item, its price, by when).
// Recording progress never moves money; it only keeps count.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import { dateParts, type IsoDate } from '../lib/dates.js'
import { isoDateSchema } from '../lib/schemas.js'
import { periodContaining, type PeriodConfig } from '../lib/periods.js'
import { patchOf } from '../lib/schemas.js'
import { listAccounts } from './accounts.js'
import { fundsOf } from './goalFunds.js'
import { listContributions, progressFacts, recordContribution } from './goalHistory.js'
import { planOf, type GoalPlan, type GoalProgressFacts, type GoalStatus } from './goalPlan.js'

const GOAL_KINDS = ['savings', 'purchase'] as const

export const goalInputSchema = z.object({
  /** savings: a pot to fill, like an emergency fund. purchase: one thing to buy, named by `name`. */
  kind: z.enum(GOAL_KINDS).default('savings'),
  name: z.string().trim().min(1).max(80),
  /** The amount to save, or for a purchase its price. */
  targetCents: z.number().int().positive(),
  targetDate: isoDateSchema.nullable().default(null),
  /** Track a savings account's balance as progress, instead of counting by hand. */
  accountId: z.uuid().nullable().default(null),
  /** Saved so far, for a goal not linked to an account. */
  savedCents: z.number().int().min(0).default(0),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4f8cff')
    .default('#4f8cff'),
  /** Hold what the goal needs each budget period back from safe-to-spend. Needs a target date. */
  setAside: z.boolean().default(false),
})

export const goalPatchSchema = patchOf(goalInputSchema)

export type GoalInput = z.infer<typeof goalInputSchema>

/** A goal as stored, with its linked account's name and balance. */
export interface GoalRow extends GoalInput {
  id: string
  accountName: string | null
  accountBalanceCents: number | null
  /**
   * For a goal following an account its bank no longer shares: the day it
   * stopped, which the balance and so the progress are as of. Null otherwise.
   */
  balanceAsOf: IsoDate | null
  /** The day the goal was made. */
  createdOn: IsoDate
  /** For the emergency fund: its target in months of essential spending. Null for any other goal. */
  emergencyMonths: number | null
  /**
   * The accounts an emergency fund counts when it is not linked to one
   * account (see emergencyPlan.ts); accountBalanceCents is then their total.
   * Null for any other goal.
   */
  followedAccountIds: string[] | null
}

export interface GoalProgress extends GoalRow {
  /** Progress: the linked account's balance, or what was counted by hand. */
  currentCents: number
  remainingCents: number
  /** 0 to 100. */
  percent: number
  /** Whole months left until the target date, counting the current one; null without a date. */
  monthsLeft: number | null
  /** What to set aside each month to make the date; null without a date, once reached, or stale. */
  monthlyNeededCents: number | null
  status: GoalStatus
}

export type Goal = GoalProgress & GoalPlan

/** Today, and how the owner slices time into budget periods. */
export interface GoalClock {
  today: IsoDate
  period: PeriodConfig
}

/** Months from today's month to the target's month, counting both: November to January is 3. */
function monthsUntil(today: IsoDate, target: IsoDate): number {
  const from = dateParts(today)
  const to = dateParts(target)
  return (to.year - from.year) * 12 + (to.month - from.month) + 1
}

function goalStatus(row: GoalRow, reached: boolean, today: IsoDate): GoalStatus {
  // A balance frozen when the bank stopped sharing it says nothing about now,
  // so the goal is neither reached nor behind; it is shown as of that day.
  if (row.balanceAsOf !== null) return 'stale'
  if (reached) return 'reached'
  return row.targetDate !== null && row.targetDate < today ? 'past_due' : 'in_progress'
}

/** A goal's progress and what it takes each month to reach it on time. */
export function progressOf(row: GoalRow, today: IsoDate): GoalProgress {
  const follows = row.accountId !== null || row.followedAccountIds !== null
  const current = follows ? Math.max(0, row.accountBalanceCents ?? 0) : row.savedCents
  const remaining = Math.max(0, row.targetCents - current)
  const months = row.targetDate ? monthsUntil(today, row.targetDate) : null
  const status = goalStatus(row, remaining === 0, today)
  const planned = status === 'in_progress' || status === 'past_due'
  return {
    ...row,
    currentCents: current,
    remainingCents: remaining,
    percent: Math.min(100, Math.floor((current / row.targetCents) * 100)),
    monthsLeft: months === null ? null : Math.max(0, months),
    // Past due, everything left is needed now.
    monthlyNeededCents:
      !planned || months === null ? null : Math.ceil(remaining / Math.max(1, months)),
    status,
  }
}

/** A goal in full: progress, plus its plan in the owner's budget periods. */
export function goalOf(row: GoalRow, facts: GoalProgressFacts, clock: GoalClock): Goal {
  const progress = progressOf(row, clock.today)
  return { ...progress, ...planOf(progress, facts, clock.today, clock.period) }
}

const SELECT = `
  SELECT g.id, g.kind, g.name, g.target_cents AS "targetCents", g.target_date AS "targetDate",
    g.account_id AS "accountId", g.saved_cents AS "savedCents", g.color, g.set_aside AS "setAside",
    g.created_at::date AS "createdOn", g.emergency_months AS "emergencyMonths",
    a.balance_cents AS "accountBalanceCents", a.unshared_at::date AS "balanceAsOf"
  FROM goals g LEFT JOIN accounts a ON a.id = g.account_id`

/** The order goals are listed in: the owner's ranking (goalOrder.ts), oldest first within it. */
const IN_ORDER = 'ORDER BY g.position, g.created_at, g.name'

type StoredGoal = Omit<GoalRow, 'accountName' | 'followedAccountIds'>

/**
 * Goals as read, with the account each follows named as everywhere else, and
 * an emergency fund's balance added up from the accounts it counts.
 */
async function namedGoals(db: Db, rows: StoredGoal[]): Promise<GoalRow[]> {
  const accounts = await listAccounts(db)
  const names = new Map(accounts.map((account) => [account.id, account.name]))
  const funds = await fundsOf(db, accounts, rows)
  return rows.map((row) => {
    const fund = funds.get(row.id)
    return {
      ...row,
      accountName: row.accountId === null ? null : (names.get(row.accountId) ?? null),
      accountBalanceCents: fund ? fund.balanceCents : row.accountBalanceCents,
      followedAccountIds: fund ? fund.accountIds : null,
    }
  })
}

async function withPlans(db: Db, rows: GoalRow[], clock: GoalClock): Promise<Goal[]> {
  const period = periodContaining(clock.today, clock.period)
  const progress = rows.map((row) => progressOf(row, clock.today))
  const facts = await progressFacts(db, progress, clock.today, period)
  return rows.map((row) => goalOf(row, facts.get(row.id)!, clock))
}

export async function listGoals(db: Db, clock: GoalClock): Promise<Goal[]> {
  const { rows } = await db.query<StoredGoal>(`${SELECT} ${IN_ORDER}`)
  return withPlans(db, await namedGoals(db, rows), clock)
}

export async function getGoal(db: Db, id: string, clock: GoalClock): Promise<Goal> {
  const { rows } = await db.query<StoredGoal>(`${SELECT} WHERE g.id = $1`, [id])
  if (!rows[0]) throw notFound('Goal')
  return (await withPlans(db, await namedGoals(db, rows), clock))[0]!
}

/** The checks a goal must pass however it was made or changed. */
async function assertValid(db: Db, goal: GoalInput): Promise<void> {
  if (goal.setAside && goal.targetDate === null) {
    throw new AppError(
      'invalid_input',
      `Give ${goal.name} a date to set money aside for it, so Leeway knows how much each period needs`,
    )
  }
  if (!goal.accountId) return
  const { rowCount } = await db.query('SELECT 1 FROM accounts WHERE id = $1', [goal.accountId])
  if (!rowCount) throw notFound('Account')
}

export async function createGoal(db: Db, input: GoalInput, clock: GoalClock): Promise<Goal> {
  await assertValid(db, input)
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO goals (kind, name, target_cents, target_date, account_id, saved_cents, color, set_aside)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.kind,
      input.name,
      input.targetCents,
      input.targetDate,
      input.accountId,
      input.savedCents,
      input.color,
      input.setAside,
    ],
  )
  return getGoal(db, rows[0]!.id, clock)
}

/**
 * Changes only the fields given. A changed "saved so far" is a correction, not
 * a contribution, so it does not count toward recent progress.
 */
export async function updateGoal(
  db: Db,
  id: string,
  patch: z.infer<typeof goalPatchSchema>,
  clock: GoalClock,
): Promise<Goal> {
  const next = { ...(await getGoal(db, id, clock)), ...patch }
  await assertValid(db, next)
  await db.query(
    `UPDATE goals SET kind = $2, name = $3, target_cents = $4, target_date = $5, account_id = $6,
       saved_cents = $7, color = $8, set_aside = $9
     WHERE id = $1`,
    [
      id,
      next.kind,
      next.name,
      next.targetCents,
      next.targetDate,
      next.accountId,
      next.savedCents,
      next.color,
      next.setAside,
    ],
  )
  return getGoal(db, id, clock)
}

/**
 * Records money put toward (or, with a negative amount, taken back from) a
 * goal counted by hand, on `day`. Taking back more than was saved takes back
 * what there is. It records the change only; no money moves. Run it in a
 * transaction: the goal row is locked so two quick taps cannot both count.
 */
export async function addToGoal(
  db: Db,
  id: string,
  amountCents: number,
  day: IsoDate,
  clock: GoalClock,
): Promise<Goal> {
  if (day > clock.today) {
    throw new AppError('invalid_input', 'Record money on today or an earlier day')
  }
  const goal = await getGoal(db, id, clock)
  if (goal.accountId || goal.followedAccountIds) {
    const balance = goal.accountId ? `the balance of ${goal.accountName}` : 'your savings'
    throw new AppError(
      'invalid_input',
      `${goal.name} follows ${balance}, so its progress updates on its own`,
    )
  }
  const { rows } = await db.query<{ saved: number }>(
    'SELECT saved_cents AS saved FROM goals WHERE id = $1 FOR UPDATE',
    [id],
  )
  const applied = Math.max(-rows[0]!.saved, amountCents)
  if (applied === 0) {
    throw new AppError('invalid_input', `Nothing is saved toward ${goal.name} yet to take back`)
  }
  await recordContribution(db, id, applied, day)
  return getGoal(db, id, clock)
}

/** A goal's recent contributions, newest first. */
export async function goalContributions(db: Db, id: string, limit: number) {
  const { rowCount } = await db.query('SELECT 1 FROM goals WHERE id = $1', [id])
  if (!rowCount) throw notFound('Goal')
  return listContributions(db, id, limit)
}

export async function deleteGoal(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM goals WHERE id = $1', [id])
  if (!rowCount) throw notFound('Goal')
}
