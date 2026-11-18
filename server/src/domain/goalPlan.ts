// A goal's plan: what to set aside each budget period, when recent progress
// would reach it, whether that is in time, and what it holds back from the
// budget. Pure: the goal and its recent progress come in, nothing is read here.

import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import { cadenceOf, PER_YEAR, periodContaining, type PeriodConfig } from '../lib/periods.js'

/** How a goal stands, from goals.ts: just the parts the plan needs. */
export interface GoalStanding {
  targetDate: IsoDate | null
  remainingCents: number
  setAside: boolean
  status: 'reached' | 'in_progress' | 'past_due'
}

/** What was put toward a goal lately, read from its history (see goalHistory.ts). */
export interface GoalProgressFacts {
  /** Net amount put toward it since the current budget period began. */
  savedThisPeriodCents: number
  /** Net amount put toward it over the recent window, and that window's length in days. */
  recentSavedCents: number
  recentDays: number
}

export interface GoalPlan {
  /** Budget periods until the target date, counting the current one; null without a date. */
  periodsLeft: number | null
  /** What to set aside each budget period to make the date; null without a date or once reached. */
  perPeriodCents: number | null
  savedThisPeriodCents: number
  /** What is still to set aside this period; null when there is no per-period amount. */
  thisPeriodLeftCents: number | null
  /** The recent pace, as an amount per budget period; zero when nothing was put aside lately. */
  recentPerPeriodCents: number
  /** When the goal is reached if the recent pace holds; null without recent progress or once reached. */
  projectedDate: IsoDate | null
  /** Whether the projection makes the target date; null without a date or once reached. */
  onTrack: boolean | null
  /** What this goal holds back from safe-to-spend this period (zero unless set aside). */
  heldBackCents: number
}

/** Past this many periods (ten years of weeks), counting one by one gains nothing. */
const MAX_COUNTED_PERIODS = 520

/** A projection further out than this says more about a trickle than a date. */
const MAX_PROJECTED_DAYS = 365 * 50

/** The average length of one budget period in days: 30.4 for a month, 14 for two weeks. */
export function averagePeriodDays(config: PeriodConfig): number {
  return 365.25 / PER_YEAR[cadenceOf(config)]
}

/**
 * Budget periods from today's to the one holding `target`, counting both, so
 * mid-November to the end of January is 3 monthly periods. A date already
 * behind the current period is 0.
 */
export function periodsUntil(today: IsoDate, target: IsoDate, config: PeriodConfig): number {
  let period = periodContaining(today, config)
  if (target < period.start) return 0
  let count = 1
  while (target >= period.end) {
    if (count >= MAX_COUNTED_PERIODS) {
      // Decades away: the average period length is close enough from here.
      return count + Math.ceil(daysBetween(period.end, target) / averagePeriodDays(config))
    }
    period = periodContaining(period.end, config)
    count += 1
  }
  return count
}

/**
 * The per-period amount. It is worked out from where the goal stood when the
 * period began, so putting money aside during a period does not shrink that
 * period's share. Past the date, everything left is needed now.
 */
function perPeriodNeeded(
  goal: GoalStanding,
  periodsLeft: number | null,
  savedThisPeriod: number,
): number | null {
  if (goal.status === 'reached' || periodsLeft === null) return null
  if (goal.status === 'past_due') return goal.remainingCents
  const atPeriodStart = Math.max(0, goal.remainingCents + savedThisPeriod)
  return Math.ceil(atPeriodStart / Math.max(1, periodsLeft))
}

/** When the remaining amount is covered at `perDay`, or null when that is never (or absurdly far). */
function projectReach(remaining: number, perDay: number, today: IsoDate): IsoDate | null {
  if (perDay <= 0) return null
  const days = Math.ceil(remaining / perDay)
  return days > MAX_PROJECTED_DAYS ? null : addDays(today, days)
}

function onTrackOf(goal: GoalStanding, projected: IsoDate | null): boolean | null {
  if (goal.status === 'reached' || goal.targetDate === null) return null
  if (goal.status === 'past_due' || projected === null) return false
  return projected <= goal.targetDate
}

/** The plan for one goal in the owner's budget periods. */
export function planOf(
  goal: GoalStanding,
  facts: GoalProgressFacts,
  today: IsoDate,
  config: PeriodConfig,
): GoalPlan {
  const reached = goal.status === 'reached'
  const periodsLeft =
    goal.targetDate === null || reached ? null : periodsUntil(today, goal.targetDate, config)
  const perPeriodCents = perPeriodNeeded(goal, periodsLeft, facts.savedThisPeriodCents)
  const perDay = facts.recentSavedCents / Math.max(1, facts.recentDays)
  const projectedDate = reached ? null : projectReach(goal.remainingCents, perDay, today)
  // Only a goal still in reach holds money back: a reached one needs nothing,
  // and a past-due one is the owner's call (move the date or the target).
  const holds = goal.setAside && goal.status === 'in_progress' && perPeriodCents !== null
  return {
    periodsLeft,
    perPeriodCents,
    savedThisPeriodCents: facts.savedThisPeriodCents,
    thisPeriodLeftCents:
      perPeriodCents === null ? null : Math.max(0, perPeriodCents - facts.savedThisPeriodCents),
    recentPerPeriodCents: Math.max(0, Math.round(perDay * averagePeriodDays(config))),
    projectedDate,
    onTrack: onTrackOf(goal, projectedDate),
    heldBackCents: holds ? perPeriodCents : 0,
  }
}
