// What was put toward each goal and when: the contributions recorded by hand,
// or a linked account's balance history. It feeds each goal's plan (see
// goalPlan.ts). Recording a contribution only keeps count; no money moves.

import type { Db } from '../db/pool.js'
import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import type { Period } from '../lib/periods.js'
import type { GoalProgressFacts } from './goalPlan.js'

/** How far back "recent progress" looks. */
export const RECENT_DAYS = 90

/**
 * The shortest window a pace is measured over. A goal started last week with
 * one deposit would otherwise project as if that deposit came every week.
 */
export const MIN_RECENT_DAYS = 30

/** The parts of a goal its history depends on. */
export interface GoalHistorySubject {
  id: string
  accountId: string | null
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

/** Recent progress for every goal given, in two queries however many there are. */
export async function progressFacts(
  db: Db,
  goals: GoalHistorySubject[],
  today: IsoDate,
  period: Period,
): Promise<Map<string, GoalProgressFacts>> {
  const byHand = goals.filter((g) => g.accountId === null)
  const linked = goals.filter((g) => g.accountId !== null)
  // A budget period is a month at most, so it starts inside the 90-day window.
  const windowStart = addDays(today, -(RECENT_DAYS - 1))
  // One at a time: db may be a transaction's client, which runs one query at once.
  const sums = await contributionSums(
    db,
    byHand.map((g) => g.id),
    today,
    period,
  )
  const balances = await balanceHistory(
    db,
    linked.map((g) => g.accountId!),
    windowStart,
  )
  const facts = new Map<string, GoalProgressFacts>()
  for (const goal of byHand) {
    const sum = sums.get(goal.id)
    facts.set(goal.id, {
      savedThisPeriodCents: sum?.thisPeriod ?? 0,
      recentSavedCents: sum?.recent ?? 0,
      // A goal made last month has only had a month to make progress in.
      recentDays: clampDays(daysBetween(goal.createdOn, today) + 1),
    })
  }
  for (const goal of linked) {
    const points = balances.get(goal.accountId!) ?? []
    facts.set(goal.id, linkedFacts(points, goal.currentCents, today, period))
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
