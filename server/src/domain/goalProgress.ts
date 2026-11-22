// A goal's progress, in pure functions: how much is saved (an account's
// balance, the emergency fund's accounts, or a count kept by hand), what is
// left, where it stands, and its plan in the owner's budget periods. goals.ts
// reads goals from the database and hands them here.

import { dateParts, type IsoDate } from '../lib/dates.js'
import type { PeriodConfig } from '../lib/periods.js'
import { planOf, type GoalPlan, type GoalProgressFacts, type GoalStatus } from './goalPlan.js'
import type { GoalInput } from './goals.js'
import { periodConfig, type Settings } from './settings.js'

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
  /**
   * For the emergency fund: its step in months of essential spending, which
   * sizes its target from today's essentials unless the owner typed their own
   * (see goalFunds.ts). Null for any other goal.
   */
  emergencyMonths: number | null
  /**
   * The accounts an emergency fund counts when it is not linked to one
   * account or counted by hand (see emergencyPlan.ts); accountBalanceCents
   * is then their total. Null for any other goal.
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

/** The clock, and the settings the emergency fund is measured by, so goals never read them again. */
export interface GoalReading extends GoalClock {
  settings: Settings
}

/** What reading goals needs, from settings already read and today's date. */
export const goalReading = (settings: Settings, today: IsoDate): GoalReading => ({
  today,
  period: periodConfig(settings),
  settings,
})

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
