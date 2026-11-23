// The emergency fund as the goals read it: the accounts it counts (the ones
// the owner marked, or every savings account, never one another goal
// follows), what they hold, and its target sized from today's essential
// spending. Read along with the goals, so the fund's progress and target are
// always as of now, the same on its card, in the goals list and in the profile.

import type { Db } from '../db/pool.js'
import type { Account } from './accounts.js'
import {
  accountsOtherGoalsFollow,
  findFund,
  fundAccounts,
  fundBalance,
  namesEmergencyFund,
  targetFor,
  type FundState,
} from './emergencyPlan.js'
import type { GoalReading } from './goalProgress.js'
import { readEssentials, type EssentialsReading } from './monthlyEssentials.js'

/** The fund as of now, for the goal that is it. */
export interface FollowedFund {
  /**
   * The accounts it counts; null when it follows the one account its form
   * links, or is counted by hand, as any other goal would be. Empty when the
   * one account it links is one another goal follows, which it then leaves out.
   */
  accountIds: string[] | null
  /** What those accounts hold; null alongside accountIds. */
  balanceCents: number | null
  targetCents: number
}

/** What reading the fund needs of a goal as stored. */
export interface FundRow {
  id: string
  name: string
  accountId: string | null
  targetCents: number
  emergencyMonths: number | null
  /** The owner's own target amount, rather than months of essentials. */
  emergencyOwnTarget: boolean
  /** Counted by hand, as the goal taken as the fund was. */
  emergencyByHand: boolean
}

/** What telling the fund apart reads of every goal: which one it is, and which accounts others follow. */
export interface GoalLink {
  id: string
  name: string
  accountId: string | null
  emergencyMonths: number | null
}

/**
 * The order goals are listed in, for a query on goals as g: the owner's
 * ranking (goalRanking.ts), oldest first within it. Shared by the goals list
 * and goalLinks, so findFund picks the same fund from either.
 */
export const GOALS_IN_ORDER = 'ORDER BY g.position, g.created_at, g.name'

/** Every goal, in the goals list's order, so findFund picks the same fund it does. */
export async function goalLinks(db: Db): Promise<GoalLink[]> {
  const { rows } = await db.query<GoalLink>(
    `SELECT g.id, g.name, g.account_id AS "accountId", g.emergency_months AS "emergencyMonths"
     FROM goals g ${GOALS_IN_ORDER}`,
  )
  return rows
}

/**
 * A goal about to be saved that links an account, as telling the fund apart
 * reads it; a new goal has no id yet.
 */
export type SavingGoalLink = Omit<GoalLink, 'id' | 'accountId'> & {
  id: string | null
  accountId: string
}

/** Stands in for the id of a goal not made yet, which sorts after every goal there is. */
const NEW_GOAL = ''

/**
 * The goal already following the account a goal links, when that goal, saved
 * as given, would be the emergency fund: the account's savings count toward
 * the other goal only, so the fund can't link it. Null when it would not be
 * the fund, or no other goal follows that account.
 */
export function fundLinkTakenBy(goals: GoalLink[], goal: SavingGoalLink): string | null {
  const saving = { ...goal, id: goal.id ?? NEW_GOAL }
  // The goal as it will be: in its own place, or last as the newest.
  const after =
    goal.id === null ? [...goals, saving] : goals.map((one) => (one.id === goal.id ? saving : one))
  if (findFund(after)?.id !== saving.id) return null
  return accountsOtherGoalsFollow(after, saving.id).get(goal.accountId) ?? null
}

/**
 * The accounts the owner marked for a fund, the accounts every other goal
 * follows (which the fund leaves out), and whether its target is the owner's
 * own. One query, used wherever the fund is worked out, so its card and the
 * goals list always agree.
 */
export async function fundState(db: Db, goalId: string): Promise<FundState> {
  const { rows } = await db.query<FundState>(
    `SELECT
       ARRAY(SELECT account_id FROM goal_accounts WHERE goal_id = $1 ORDER BY account_id)
         AS "markedIds",
       ARRAY(SELECT DISTINCT account_id FROM goals WHERE id <> $1 AND account_id IS NOT NULL)
         AS "otherGoalAccountIds",
       coalesce((SELECT emergency_own_target FROM goals WHERE id = $1), false) AS "ownTarget"`,
    [goalId],
  )
  // A SELECT with no FROM always returns exactly one row.
  return rows[0]!
}

/** A fund's stored state, read once in a reading of the goals. */
export async function stateOf(db: Db, reading: GoalReading, goalId: string): Promise<FundState> {
  const known = reading.reads.states.get(goalId)
  if (known) return known
  const state = await fundState(db, goalId)
  reading.reads.states.set(goalId, state)
  return state
}

/** Essential spending and the owner's choice of essentials, read once in a reading of the goals. */
export async function essentialsOf(db: Db, reading: GoalReading): Promise<EssentialsReading> {
  reading.reads.essentials ??= await readEssentials(db, reading.settings, reading.today)
  return reading.reads.essentials
}

/**
 * The fund's target as of now: its months of today's essential spending, so it
 * grows when essentials do. The owner's own amount stays as they set it, and
 * without essentials to size it by, the last target stored stands.
 */
async function targetNow(db: Db, fund: FundRow, reading: GoalReading): Promise<number> {
  if (fund.emergencyOwnTarget || fund.emergencyMonths === null) return fund.targetCents
  const { essentials } = await essentialsOf(db, reading)
  return essentials ? targetFor(fund.emergencyMonths, essentials.cents) : fund.targetCents
}

/** Counts nothing: the one account a fund links is one another goal follows. */
const leftOut = () => ({ accountIds: [], balanceCents: 0 })

/**
 * The accounts the fund counts and what they hold, unless it follows its one
 * account or a count by hand as any goal would. `taken` says another goal
 * follows that one account, so the fund counts nothing from it.
 */
async function followedOf(
  db: Db,
  accounts: Account[],
  fund: FundRow,
  reading: GoalReading,
  taken: boolean,
): Promise<Pick<FollowedFund, 'accountIds' | 'balanceCents'>> {
  if (fund.accountId !== null) return taken ? leftOut() : { accountIds: null, balanceCents: null }
  if (fund.emergencyByHand) return { accountIds: null, balanceCents: null }
  const state = await stateOf(db, reading, fund.id)
  const counted = fundAccounts(accounts, state, reading.settings.currency).accounts
  return { accountIds: counted.map((a) => a.id), balanceCents: fundBalance(counted) }
}

/**
 * The fund among the goals given, by goal id, as of now. Reads nothing more
 * unless one of them could be the fund and count accounts: one marked as the
 * fund, or one named as a fund that follows an account. A goal named as a
 * fund but not marked yet reads as it is (by hand or its one account), except
 * that an account another goal follows counts toward that goal only.
 */
export async function fundsOf(
  db: Db,
  accounts: Account[],
  rows: FundRow[],
  reading: GoalReading,
): Promise<Map<string, FollowedFund>> {
  const maybe = rows.some(
    (row) =>
      row.emergencyMonths !== null || (row.accountId !== null && namesEmergencyFund(row.name)),
  )
  if (!maybe) return new Map()
  // One at a time: db may be a transaction's client, which runs one query at once.
  const links = await goalLinks(db)
  const found = findFund(links)
  const fund = found && rows.find((row) => row.id === found.id)
  if (!fund) return new Map()
  const taken =
    fund.accountId !== null && accountsOtherGoalsFollow(links, fund.id).has(fund.accountId)
  if (fund.emergencyMonths === null) {
    return taken ? new Map([[fund.id, { ...leftOut(), targetCents: fund.targetCents }]]) : new Map()
  }
  const followed = await followedOf(db, accounts, fund, reading, taken)
  return new Map([[fund.id, { ...followed, targetCents: await targetNow(db, fund, reading) }]])
}
