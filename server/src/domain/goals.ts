// Savings goals: a target amount, an optional date, and progress toward it.
// Recording progress never moves money; it only keeps count.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import { dateParts, isIsoDate, type IsoDate } from '../lib/dates.js'
import { patchOf } from '../lib/schemas.js'

export const goalInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  targetCents: z.number().int().positive(),
  targetDate: z
    .string()
    .refine(isIsoDate, 'Use a real date as YYYY-MM-DD')
    .nullable()
    .default(null),
  /** Track a savings account's balance as progress, instead of counting by hand. */
  accountId: z.uuid().nullable().default(null),
  /** Saved so far, for a goal not linked to an account. */
  savedCents: z.number().int().min(0).default(0),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4f8cff')
    .default('#4f8cff'),
})

export const goalPatchSchema = patchOf(goalInputSchema)

export type GoalInput = z.infer<typeof goalInputSchema>

interface GoalRow extends GoalInput {
  id: string
  accountName: string | null
  accountBalanceCents: number | null
}

export interface Goal extends GoalRow {
  /** Progress: the linked account's balance, or what was counted by hand. */
  currentCents: number
  remainingCents: number
  /** 0 to 100. */
  percent: number
  /** Whole months left until the target date, counting the current one; null without a date. */
  monthsLeft: number | null
  /** What to set aside each month to make the date; null without a date or once reached. */
  monthlyNeededCents: number | null
  status: 'reached' | 'in_progress' | 'past_due'
}

/** Months from today's month to the target's month, counting both: November to January is 3. */
function monthsUntil(today: IsoDate, target: IsoDate): number {
  const from = dateParts(today)
  const to = dateParts(target)
  return (to.year - from.year) * 12 + (to.month - from.month) + 1
}

function goalStatus(reached: boolean, pastDue: boolean): Goal['status'] {
  if (reached) return 'reached'
  return pastDue ? 'past_due' : 'in_progress'
}

/** A goal's progress and what it takes to reach it on time. */
export function progressOf(row: GoalRow, today: IsoDate): Goal {
  const current = row.accountId ? Math.max(0, row.accountBalanceCents ?? 0) : row.savedCents
  const remaining = Math.max(0, row.targetCents - current)
  const months = row.targetDate ? monthsUntil(today, row.targetDate) : null
  const reached = remaining === 0
  const pastDue = !reached && row.targetDate !== null && row.targetDate < today
  return {
    ...row,
    currentCents: current,
    remainingCents: remaining,
    percent: Math.min(100, Math.floor((current / row.targetCents) * 100)),
    monthsLeft: months === null ? null : Math.max(0, months),
    // Past due, everything left is needed now.
    monthlyNeededCents:
      reached || months === null ? null : Math.ceil(remaining / Math.max(1, months)),
    status: goalStatus(reached, pastDue),
  }
}

const SELECT = `
  SELECT g.id, g.name, g.target_cents AS "targetCents", g.target_date AS "targetDate",
    g.account_id AS "accountId", g.saved_cents AS "savedCents", g.color,
    coalesce(a.display_name, a.name) AS "accountName", a.balance_cents AS "accountBalanceCents"
  FROM goals g LEFT JOIN accounts a ON a.id = g.account_id`

export async function listGoals(db: Db, today: IsoDate): Promise<Goal[]> {
  const { rows } = await db.query<GoalRow>(`${SELECT} ORDER BY g.created_at, g.name`)
  return rows.map((row) => progressOf(row, today))
}

export async function getGoal(db: Db, id: string, today: IsoDate): Promise<Goal> {
  const { rows } = await db.query<GoalRow>(`${SELECT} WHERE g.id = $1`, [id])
  if (!rows[0]) throw notFound('Goal')
  return progressOf(rows[0], today)
}

async function assertAccount(db: Db, accountId: string | null): Promise<void> {
  if (!accountId) return
  const { rowCount } = await db.query('SELECT 1 FROM accounts WHERE id = $1', [accountId])
  if (!rowCount) throw notFound('Account')
}

export async function createGoal(db: Db, input: GoalInput, today: IsoDate): Promise<Goal> {
  await assertAccount(db, input.accountId)
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO goals (name, target_cents, target_date, account_id, saved_cents, color)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.name,
      input.targetCents,
      input.targetDate,
      input.accountId,
      input.savedCents,
      input.color,
    ],
  )
  return getGoal(db, rows[0]!.id, today)
}

export async function updateGoal(
  db: Db,
  id: string,
  patch: z.infer<typeof goalPatchSchema>,
  today: IsoDate,
): Promise<Goal> {
  const next = { ...(await getGoal(db, id, today)), ...patch }
  await assertAccount(db, next.accountId)
  await db.query(
    `UPDATE goals SET name = $2, target_cents = $3, target_date = $4, account_id = $5,
       saved_cents = $6, color = $7
     WHERE id = $1`,
    [id, next.name, next.targetCents, next.targetDate, next.accountId, next.savedCents, next.color],
  )
  return getGoal(db, id, today)
}

/**
 * Adds to (or, with a negative amount, takes from) what was saved toward a
 * goal counted by hand. It records the change only; no money moves.
 */
export async function addToGoal(
  db: Db,
  id: string,
  amountCents: number,
  today: IsoDate,
): Promise<Goal> {
  const goal = await getGoal(db, id, today)
  if (goal.accountId) {
    throw new AppError(
      'invalid_input',
      `${goal.name} follows the balance of ${goal.accountName}, so its progress updates on its own`,
    )
  }
  await db.query('UPDATE goals SET saved_cents = greatest(0, saved_cents + $2) WHERE id = $1', [
    id,
    amountCents,
  ])
  return getGoal(db, id, today)
}

export async function deleteGoal(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM goals WHERE id = $1', [id])
  if (!rowCount) throw notFound('Goal')
}
