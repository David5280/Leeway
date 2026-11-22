// The owner's ranking of their goals, and what it means in dates: the monthly
// amount for goals fills them one after another (goalOrder.ts). The amount is
// the owner's own, or the pace Leeway sees going into the goals lately.

import type { Db } from '../db/pool.js'
import { AppError } from '../errors.js'
import type { IsoDate } from '../lib/dates.js'
import { cadenceOf, convertCadence } from '../lib/periods.js'
import { landings, type GoalLanding } from './goalOrder.js'
import { goalReading, type Goal } from './goalProgress.js'
import { listGoals } from './goals.js'
import { periodConfig, type Settings } from './settings.js'

/** Where the monthly amount came from: the owner, the recent pace, or nowhere yet. */
export type GoalAmountSource = 'entered' | 'found' | 'none'

export interface GoalOrder {
  /** What goes to goals each month, filling them in order. */
  monthlyCents: number
  source: GoalAmountSource
  /** Every goal, first to last, with the month each lands in. */
  goals: GoalLanding[]
}

/** The recent pace into the goals still being saved for, as a monthly amount. */
function recentMonthlyPace(goals: Goal[], settings: Settings): number {
  const perPeriod = goals
    .filter((goal) => goal.status === 'in_progress' || goal.status === 'past_due')
    .reduce((sum, goal) => sum + goal.recentPerPeriodCents, 0)
  return convertCadence(perPeriod, cadenceOf(periodConfig(settings)), 'month')
}

/** The monthly amount for goals, and where it came from. */
function monthlyAmount(goals: Goal[], settings: Settings) {
  const entered = settings.savingsPlan.goalsMonthlyCents
  if (entered !== null) return { monthlyCents: entered, source: 'entered' as const }
  const found = recentMonthlyPace(goals, settings)
  return found > 0
    ? { monthlyCents: found, source: 'found' as const }
    : { monthlyCents: 0, source: 'none' as const }
}

/** The goals in the owner's order, with the month each lands in. */
export async function getGoalOrder(db: Db, settings: Settings, today: IsoDate): Promise<GoalOrder> {
  const goals = await listGoals(db, goalReading(settings, today))
  const amount = monthlyAmount(goals, settings)
  return { ...amount, goals: landings(goals, amount.monthlyCents, today) }
}

/**
 * Puts goals in the order given, first to last. Goals left out keep their
 * order after the ones given, so an assistant can move one goal to the top
 * by naming just that one. An id that is no goal is refused. Run it in a
 * transaction.
 */
export async function reorderGoals(db: Db, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)]
  // Every goal is renumbered, so lock them all first, in the same order a
  // change to the emergency fund does: two at once then wait, never deadlock.
  await db.query('SELECT id FROM goals ORDER BY id FOR UPDATE')
  const { rowCount } = await db.query('SELECT 1 FROM goals WHERE id = ANY($1::uuid[])', [unique])
  if (rowCount !== unique.length) {
    throw new AppError('not_found', 'One of those goals no longer exists. Refresh and try again.')
  }
  // Numbers every goal 1, 2, 3 and on: the ones given first, then the rest in
  // the order they had. Positions never pass the number of goals, so they stay
  // below every number the sequence hands out, and a new goal always joins last.
  await db.query(
    `UPDATE goals g SET position = ranked.n
     FROM (
       SELECT goal.id, row_number() OVER (
         ORDER BY given.n NULLS LAST, goal.position, goal.created_at, goal.name
       ) AS n
       FROM goals goal
       LEFT JOIN unnest($1::uuid[]) WITH ORDINALITY AS given(id, n) ON given.id = goal.id
     ) ranked
     WHERE ranked.id = g.id`,
    [unique],
  )
}
