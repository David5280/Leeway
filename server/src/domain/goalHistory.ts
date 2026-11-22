// What was put toward each goal and when: the contributions recorded by hand,
// a linked account's balance history, or for the emergency fund the history
// of the accounts it counts, added up. It feeds each goal's plan (see
// goalPlan.ts). Recording a contribution only keeps count; no money moves.

import type { Db } from '../db/pool.js'
import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import type { Period } from '../lib/periods.js'
import type { GoalProgressFacts } from './goalPlan.js'

/** How far back "recent progress" looks. */
const RECENT_DAYS = 90

/**
 * The shortest window a pace is measured over. A goal started last week with
 * one deposit would otherwise project as if that deposit came every week.
 */
export const MIN_RECENT_DAYS = 30

/** An account the emergency fund counts, with its balance now. */
export interface FollowedAccount {
  id: string
  balanceCents: number
}

/** The parts of a goal its history depends on. */
export interface GoalHistorySubject {
  id: string
  accountId: string | null
  /** The accounts the emergency fund counts; null for any other goal. */
  followedAccounts: FollowedAccount[] | null
  /** The day the goal was made, which bounds how long its recent window can be. */
  createdOn: IsoDate
  /** Progress today, as goals.ts counts it. */
  currentCents: number
}

export interface BalancePoint {
  day: IsoDate
  cents: number
}

const clampDays = (days: number) => Math.min(RECENT_DAYS, Math.max(MIN_RECENT_DAYS, days))

/**
 * The balance an account had going into `day`: the last one recorded before
 * it. An account first seen after that day starts from its first balance, so
 * its progress counts from when Leeway began watching it. Points are oldest
 * first; null when there are none.
 */
export function balanceGoingInto(points: BalancePoint[], day: IsoDate): BalancePoint | null {
  const before = points.filter((p) => p.day < day)
  return before.at(-1) ?? points[0] ?? null
}

/**
 * Several accounts' histories as one: on each day any of them changed, what
 * they held together, each overdrawn one counting as nothing (as it does for
 * the fund's progress). An account first seen later counts its first balance
 * from the start, and one with no history at all its balance now, so neither
 * reads as money saved just because Leeway began watching it.
 */
export function combinedHistory(
  accounts: FollowedAccount[],
  history: Map<string, BalancePoint[]>,
  today: IsoDate,
): BalancePoint[] {
  const series = accounts.map((account) => {
    const points = history.get(account.id) ?? []
    return points.length > 0 ? points : [{ day: today, cents: account.balanceCents }]
  })
  const days = [...new Set(series.flatMap((points) => points.map((p) => p.day)))].sort()
  return days.map((day) => ({
    day,
    cents: series.reduce((sum, points) => {
      // Before an account's first point, it counts that first balance. A series
      // is never empty: an account with no history got today's balance above.
      const held = points.filter((p) => p.day <= day).at(-1) ?? points[0]!
      return sum + Math.max(0, held.cents)
    }, 0),
  }))
}

/** Progress for a goal that follows an account, from its balance history. */
export function linkedFacts(
  points: BalancePoint[],
  currentCents: number,
  today: IsoDate,
  period: Period,
): GoalProgressFacts {
  const windowStart = addDays(today, -(RECENT_DAYS - 1))
  const atPeriodStart = balanceGoingInto(points, period.start)
  const atWindowStart = balanceGoingInto(points, windowStart)
  // An overdrawn balance counts as nothing saved, as it does for progress.
  const saved = (point: BalancePoint) => currentCents - Math.max(0, point.cents)
  const watchedSince = atWindowStart && atWindowStart.day >= windowStart ? atWindowStart.day : null
  return {
    savedThisPeriodCents: atPeriodStart ? saved(atPeriodStart) : 0,
    recentSavedCents: atWindowStart ? saved(atWindowStart) : 0,
    recentDays: watchedSince ? clampDays(daysBetween(watchedSince, today)) : RECENT_DAYS,
  }
}

interface ContributionSums {
  goalId: string
  thisPeriod: number
  recent: number
}

async function contributionSums(
  db: Db,
  goalIds: string[],
  today: IsoDate,
  period: Period,
): Promise<Map<string, ContributionSums>> {
  if (goalIds.length === 0) return new Map()
  const { rows } = await db.query<ContributionSums>(
    `SELECT goal_id AS "goalId",
       coalesce(sum(amount_cents) FILTER (WHERE day >= $2), 0)::bigint AS "thisPeriod",
       coalesce(sum(amount_cents) FILTER (WHERE day >= $3), 0)::bigint AS recent
     FROM goal_contributions
     WHERE goal_id = ANY($1::uuid[]) AND day <= $4
     GROUP BY goal_id`,
    [goalIds, period.start, addDays(today, -(RECENT_DAYS - 1)), today],
  )
  return new Map(rows.map((row) => [row.goalId, row]))
}

/** Each linked account's balances from `since` on, plus the last one before it. */
async function balanceHistory(
  db: Db,
  accountIds: string[],
  since: IsoDate,
): Promise<Map<string, BalancePoint[]>> {
  const byAccount = new Map<string, BalancePoint[]>()
  if (accountIds.length === 0) return byAccount
  const { rows } = await db.query<BalancePoint & { accountId: string }>(
    `SELECT account_id AS "accountId", day, balance_cents AS cents FROM (
       SELECT account_id, day, balance_cents FROM balance_history
       WHERE account_id = ANY($1::uuid[]) AND day >= $2
       UNION ALL
       (SELECT DISTINCT ON (account_id) account_id, day, balance_cents FROM balance_history
        WHERE account_id = ANY($1::uuid[]) AND day < $2
        ORDER BY account_id, day DESC)
     ) history ORDER BY day`,
    [accountIds, since],
  )
  for (const { accountId, ...point } of rows) {
    byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), point])
  }
  return byAccount
}

/**
 * The accounts whose balances make a goal's progress: the one it links, or
 * the ones the emergency fund counts. Null for a goal counted by hand.
 */
function accountsBehind(goal: GoalHistorySubject): FollowedAccount[] | null {
  // The fund's own list comes first: it is empty when another goal follows
  // the one account the fund links, so that account's savings count once.
  if (goal.followedAccounts !== null) return goal.followedAccounts
  if (goal.accountId !== null) return [{ id: goal.accountId, balanceCents: goal.currentCents }]
  return null
}

/** Recent progress for every goal given, in two queries however many there are. */
export async function progressFacts(
  db: Db,
  goals: GoalHistorySubject[],
  today: IsoDate,
  period: Period,
): Promise<Map<string, GoalProgressFacts>> {
  const subjects = goals.map((goal) => ({ goal, accounts: accountsBehind(goal) }))
  // A budget period is a month at most, so it starts inside the 90-day window.
  const windowStart = addDays(today, -(RECENT_DAYS - 1))
  // One at a time: db may be a transaction's client, which runs one query at once.
  const sums = await contributionSums(
    db,
    subjects.filter((s) => s.accounts === null).map((s) => s.goal.id),
    today,
    period,
  )
  const balances = await balanceHistory(
    db,
    subjects.flatMap((s) => s.accounts ?? []).map((account) => account.id),
    windowStart,
  )
  const facts = new Map<string, GoalProgressFacts>()
  for (const { goal, accounts } of subjects) {
    if (accounts === null) {
      const sum = sums.get(goal.id)
      facts.set(goal.id, {
        savedThisPeriodCents: sum?.thisPeriod ?? 0,
        recentSavedCents: sum?.recent ?? 0,
        // A goal made last month has only had a month to make progress in.
        recentDays: clampDays(daysBetween(goal.createdOn, today) + 1),
      })
    } else {
      const points = combinedHistory(accounts, balances, today)
      facts.set(goal.id, linkedFacts(points, goal.currentCents, today, period))
    }
  }
  return facts
}

export interface Contribution {
  id: string
  amountCents: number
  date: IsoDate
}

/** A goal's contributions, newest first. */
export async function listContributions(
  db: Db,
  goalId: string,
  limit: number,
): Promise<Contribution[]> {
  const { rows } = await db.query<Contribution>(
    `SELECT id, amount_cents AS "amountCents", day AS date FROM goal_contributions
     WHERE goal_id = $1 ORDER BY day DESC, created_at DESC LIMIT $2`,
    [goalId, limit],
  )
  return rows
}

/** Records an amount put toward (or taken back from) a goal counted by hand. */
export async function recordContribution(
  db: Db,
  goalId: string,
  amountCents: number,
  day: IsoDate,
): Promise<void> {
  await db.query(
    'INSERT INTO goal_contributions (goal_id, amount_cents, day) VALUES ($1, $2, $3)',
    [goalId, amountCents, day],
  )
  await db.query('UPDATE goals SET saved_cents = saved_cents + $2 WHERE id = $1', [
    goalId,
    amountCents,
  ])
}
