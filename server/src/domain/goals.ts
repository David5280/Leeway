// Savings goals: a target amount, an optional date, and progress toward it.
// A goal can be general savings or a purchase (an item, its price, by when).
// Recording progress never moves money; it only keeps count.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import type { IsoDate } from '../lib/dates.js'
import { isoDateSchema } from '../lib/schemas.js'
import { periodContaining } from '../lib/periods.js'
import { patchOf } from '../lib/schemas.js'
import { listAccounts, type Account } from './accounts.js'
import { followedAlready, namesEmergencyFund } from './emergencyPlan.js'
import { fundLinkTakenBy, fundsOf, goalLinks, type FundRow } from './goalFunds.js'
import { listContributions, progressFacts, recordContribution } from './goalHistory.js'
import {
  goalOf,
  progressOf,
  type Goal,
  type GoalClock,
  type GoalReading,
  type GoalRow,
} from './goalProgress.js'

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

const SELECT = `
  SELECT g.id, g.kind, g.name, g.target_cents AS "targetCents", g.target_date AS "targetDate",
    g.account_id AS "accountId", g.saved_cents AS "savedCents", g.color, g.set_aside AS "setAside",
    g.created_at::date AS "createdOn", g.emergency_months AS "emergencyMonths",
    g.emergency_own_target AS "emergencyOwnTarget", g.emergency_by_hand AS "emergencyByHand",
    a.balance_cents AS "accountBalanceCents", a.unshared_at::date AS "balanceAsOf"
  FROM goals g LEFT JOIN accounts a ON a.id = g.account_id`

/** The order goals are listed in: the owner's ranking (goalOrder.ts), oldest first within it. */
const IN_ORDER = 'ORDER BY g.position, g.created_at, g.name'

/** A goal as stored, with the fund's own columns, which goalFunds.ts reads and nothing shows. */
type StoredGoal = Omit<GoalRow, 'accountName' | 'followedAccountIds'> &
  Pick<FundRow, 'emergencyOwnTarget' | 'emergencyByHand'>

/**
 * Goals as read: the account each follows named as everywhere else, the
 * emergency fund's progress added up from the accounts it counts and its
 * target sized from today's essentials, and each goal's plan.
 */
async function readGoals(db: Db, stored: StoredGoal[], reading: GoalReading): Promise<Goal[]> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const accounts = await listAccounts(db)
  const funds = await fundsOf(db, accounts, stored, reading)
  const names = new Map(accounts.map((account) => [account.id, account.name]))
  const rows = stored.map(({ emergencyOwnTarget: _own, emergencyByHand: _hand, ...row }) => {
    const fund = funds.get(row.id)
    return {
      ...row,
      accountName: row.accountId === null ? null : (names.get(row.accountId) ?? null),
      accountBalanceCents: fund?.accountIds ? fund.balanceCents : row.accountBalanceCents,
      targetCents: fund ? fund.targetCents : row.targetCents,
      followedAccountIds: fund ? fund.accountIds : null,
    }
  })
  return withPlans(db, rows, accounts, reading)
}

async function withPlans(
  db: Db,
  rows: GoalRow[],
  accounts: Account[],
  clock: GoalClock,
): Promise<Goal[]> {
  const period = periodContaining(clock.today, clock.period)
  const balances = new Map(accounts.map((account) => [account.id, account.balanceCents ?? 0]))
  const progress = rows.map((row) => ({
    ...progressOf(row, clock.today),
    // The fund's pace comes from the balances of the accounts it counts.
    followedAccounts:
      row.followedAccountIds?.map((id) => ({ id, balanceCents: balances.get(id) ?? 0 })) ?? null,
  }))
  const facts = await progressFacts(db, progress, clock.today, period)
  // progressFacts answers for every goal it is given, so each row has its facts.
  return rows.map((row) => goalOf(row, facts.get(row.id)!, clock))
}

export async function listGoals(db: Db, reading: GoalReading): Promise<Goal[]> {
  const { rows } = await db.query<StoredGoal>(`${SELECT} ${IN_ORDER}`)
  return readGoals(db, rows, reading)
}

export async function getGoal(db: Db, id: string, reading: GoalReading): Promise<Goal> {
  const { rows } = await db.query<StoredGoal>(`${SELECT} WHERE g.id = $1`, [id])
  if (!rows[0]) throw notFound('Goal')
  const [goal] = await readGoals(db, rows, reading)
  // readGoals gives back one goal for each row, and there is one row.
  return goal!
}

/**
 * A goal about to be saved: its fields, its id and fund step unless it is
 * new, and whether it may newly link an account as the fund: its account
 * changes, or a new name makes it read as the fund.
 */
type SavingGoal = GoalInput & {
  id: string | null
  emergencyMonths: number | null
  linkChanges: boolean
}

/** The checks a goal must pass however it was made or changed. */
async function assertValid(db: Db, goal: SavingGoal): Promise<void> {
  if (goal.setAside && goal.targetDate === null) {
    throw new AppError(
      'invalid_input',
      `Give ${goal.name} a date to set money aside for it, so Leeway knows how much each period needs`,
    )
  }
  if (!goal.accountId) return
  const { rowCount } = await db.query('SELECT 1 FROM accounts WHERE id = $1', [goal.accountId])
  if (!rowCount) throw notFound('Account')
  if (!goal.linkChanges) return
  // The emergency fund can't follow an account another goal follows: it would count twice.
  const takenBy = fundLinkTakenBy(await goalLinks(db), { ...goal, accountId: goal.accountId })
  if (takenBy !== null) throw new AppError('invalid_input', followedAlready(takenBy))
}

export async function createGoal(db: Db, input: GoalInput, reading: GoalReading): Promise<Goal> {
  await assertValid(db, { ...input, id: null, emergencyMonths: null, linkChanges: true })
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
  return getGoal(db, rows[0]!.id, reading)
}

/**
 * Changes only the fields given. A changed "saved so far" is a correction, not
 * a contribution, so it does not count toward recent progress. A target typed
 * for the emergency fund becomes its own, no longer sized from essentials; a
 * save that leaves the target out (a new name, say) keeps it sized.
 */
export async function updateGoal(
  db: Db,
  id: string,
  patch: z.infer<typeof goalPatchSchema>,
  reading: GoalReading,
): Promise<Goal> {
  const current = await getGoal(db, id, reading)
  const next = { ...current, ...patch }
  // A plain rename of a fund whose account another goal took since is no new link to refuse.
  const namedFundNow = namesEmergencyFund(next.name) && !namesEmergencyFund(current.name)
  await assertValid(db, {
    ...next,
    linkChanges: next.accountId !== current.accountId || namedFundNow,
  })
  const typedTarget = patch.targetCents !== undefined && patch.targetCents !== current.targetCents
  const ownTarget = current.emergencyMonths !== null && typedTarget
  await db.query(
    `UPDATE goals SET kind = $2, name = $3, target_cents = $4, target_date = $5, account_id = $6,
       saved_cents = $7, color = $8, set_aside = $9, emergency_own_target = emergency_own_target OR $10
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
      ownTarget,
    ],
  )
  return getGoal(db, id, reading)
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
  reading: GoalReading,
): Promise<Goal> {
  if (day > reading.today) {
    throw new AppError('invalid_input', 'Record money on today or an earlier day')
  }
  const goal = await getGoal(db, id, reading)
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
  return getGoal(db, id, reading)
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
