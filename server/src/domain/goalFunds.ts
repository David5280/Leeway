// The emergency fund as the goals read it: the accounts it counts (the ones
// the owner marked, or every savings account, never one another goal
// follows), what they hold, and its target sized from today's essential
// spending. Read along with the goals, so the fund's progress and target are
// always as of now, the same on its card, in the goals list and in the profile.

import type { Db } from '../db/pool.js'
import type { Account } from './accounts.js'
import { fundAccounts, fundBalance, targetFor, type FundLinks } from './emergencyPlan.js'
import type { GoalReading } from './goalProgress.js'
import { readMonthlyEssentials } from './monthlyEssentials.js'

/** The fund as of now, for the goal that is it. */
export interface FollowedFund {
  /**
   * The accounts it counts; null when it follows the one account its form
   * links, or is counted by hand, as any other goal would be.
   */
  accountIds: string[] | null
  /** What those accounts hold; null alongside accountIds. */
  balanceCents: number | null
  targetCents: number
}

/** What reading the fund needs of a goal as stored. */
export interface FundRow {
  id: string
  accountId: string | null
  targetCents: number
  emergencyMonths: number | null
  /** The owner's own target amount, rather than months of essentials. */
  emergencyOwnTarget: boolean
  /** Counted by hand, as the goal taken as the fund was. */
  emergencyByHand: boolean
}

/** What is stored about a fund beyond its goal: the accounts it links, and whose target it is. */
export interface FundState extends FundLinks {
  ownTarget: boolean
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

/**
 * The fund's target as of now: its months of today's essential spending, so it
 * grows when essentials do. The owner's own amount stays as they set it, and
 * without essentials to size it by, the last target stored stands.
 */
async function targetNow(db: Db, fund: FundRow, reading: GoalReading): Promise<number> {
  if (fund.emergencyOwnTarget || fund.emergencyMonths === null) return fund.targetCents
  const essentials = await readMonthlyEssentials(db, reading.settings, reading.today)
  return essentials ? targetFor(fund.emergencyMonths, essentials.cents) : fund.targetCents
}

/** The accounts the fund counts and what they hold, unless it follows one account or a count by hand. */
async function followedOf(
  db: Db,
  accounts: Account[],
  fund: FundRow,
  currency: string,
): Promise<Pick<FollowedFund, 'accountIds' | 'balanceCents'>> {
  if (fund.accountId !== null || fund.emergencyByHand)
    return { accountIds: null, balanceCents: null }
  const counted = fundAccounts(accounts, await fundState(db, fund.id), currency).accounts
  return { accountIds: counted.map((a) => a.id), balanceCents: fundBalance(counted) }
}

/**
 * The fund among the goals given, by goal id, as of now. Reads nothing when
 * none of them is marked as the fund, which is the usual case. A goal named
 * as a fund but not marked yet reads as it is (by hand or its one account).
 */
export async function fundsOf(
  db: Db,
  accounts: Account[],
  rows: FundRow[],
  reading: GoalReading,
): Promise<Map<string, FollowedFund>> {
  const fund = rows.find((row) => row.emergencyMonths !== null)
  if (!fund) return new Map()
  // One at a time: db may be a transaction's client, which runs one query at once.
  const followed = await followedOf(db, accounts, fund, reading.settings.currency)
  return new Map([[fund.id, { ...followed, targetCents: await targetNow(db, fund, reading) }]])
}
