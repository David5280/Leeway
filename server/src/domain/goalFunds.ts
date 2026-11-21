// The balance an emergency fund goal follows: the accounts the owner marked
// for it, or every savings account (emergencyPlan.ts), added up. Read along
// with the goals, so a goal's progress is always the accounts' balances now.

import type { Db } from '../db/pool.js'
import type { Account } from './accounts.js'
import { fundAccounts, fundBalance } from './emergencyPlan.js'
import { getSettings } from './settings.js'

/** What a fund goal follows: the accounts it counts and what they hold. */
export interface FollowedFund {
  accountIds: string[]
  balanceCents: number
}

/** What reading funds needs of a goal. */
interface FundGoal {
  id: string
  accountId: string | null
  emergencyMonths: number | null
}

/** The accounts each goal marked, by goal id. */
async function pickedAccounts(db: Db, goalIds: string[]): Promise<Map<string, string[]>> {
  const { rows } = await db.query<{ goalId: string; accountId: string }>(
    `SELECT goal_id AS "goalId", account_id AS "accountId" FROM goal_accounts
     WHERE goal_id = ANY($1::uuid[])`,
    [goalIds],
  )
  const picked = new Map<string, string[]>()
  for (const row of rows) picked.set(row.goalId, [...(picked.get(row.goalId) ?? []), row.accountId])
  return picked
}

/**
 * The fund each emergency fund goal follows, by goal id. A goal linked to one
 * account follows that account instead, as any goal does, so it gets none.
 * Reads nothing when there is no such goal, which is the usual case.
 */
export async function fundsOf(
  db: Db,
  accounts: Account[],
  goals: FundGoal[],
): Promise<Map<string, FollowedFund>> {
  const funds = goals.filter((goal) => goal.emergencyMonths !== null && goal.accountId === null)
  if (funds.length === 0) return new Map()
  // One at a time: db may be a transaction's client, which runs one query at once.
  const { currency } = await getSettings(db)
  const picked = await pickedAccounts(
    db,
    funds.map((goal) => goal.id),
  )
  return new Map(
    funds.map((goal) => {
      const counted = fundAccounts(accounts, picked.get(goal.id) ?? [], currency).accounts
      return [goal.id, { accountIds: counted.map((a) => a.id), balanceCents: fundBalance(counted) }]
    }),
  )
}
