// What the leftover's suggestions are worked out from, read from stored
// data: the financial profile's emergency fund and savings rate, the open
// goals, the costliest debt and idle cash in checking. Each comes from the
// module that already owns it, so the playbook says what those screens say.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { convertCadence, type Cadence } from '../../lib/periods.js'
import { listDebts } from '../debts.js'
import { findFund } from '../emergencyPlan.js'
import { goalReading, type Goal } from '../goalProgress.js'
import { listGoals } from '../goals.js'
import { getIdleCash } from '../idleCashSource.js'
import { getFinancialProfile, type FinancialProfile } from '../profile/profile.js'
import { countingWords } from '../savings/rate.js'
import type { Settings } from '../settings.js'
import type { CostliestDebt, OpenGoal, RetirementGap, SuggestionFacts } from './suggestions.js'

/** Goals still being saved toward, the emergency fund left out: it has a suggestion of its own. */
export function openGoals(goals: Goal[]): OpenGoal[] {
  const fund = findFund(goals)
  return goals
    .filter((goal) => goal !== fund && goal.remainingCents > 0)
    .filter((goal) => goal.status === 'in_progress' || goal.status === 'past_due')
    .map(({ name, remainingCents, targetDate }) => ({ name, remainingCents, targetDate }))
}

/** The debt with the highest known rate; one whose rate is unknown cannot be compared. */
export function costliestDebt(debts: CostliestDebt[]): CostliestDebt | null {
  const [top] = [...debts].sort((a, b) => b.aprBps - a.aprBps || b.balanceCents - a.balanceCents)
  return top ? { name: top.name, balanceCents: top.balanceCents, aprBps: top.aprBps } : null
}

/**
 * What a pay period would need to put away to reach the savings rate target,
 * from the profile's own rate and pay, and what that rate counts. Null with
 * no target, no rate known, or the target already met. As the profile's
 * savings rate meter does (profile/lenses.ts), the rate is read against the
 * target, never as falling short: a 401(k) taken from pay before the bank
 * sees it may be missing from it.
 */
export function retirementGap(
  profile: Pick<FinancialProfile, 'savingsRate' | 'savingsRateTargetPercent'>,
  payCadence: Cadence,
): RetirementGap | null {
  const target = profile.savingsRateTargetPercent
  const rate = profile.savingsRate
  if (target === null || rate === null || rate.percent >= target) return null
  const monthlyCents = Math.round((rate.payMonthlyCents * (target - rate.percent)) / 100)
  return {
    cents: convertCadence(monthlyCents, 'month', payCadence),
    targetPercent: target,
    counting: countingWords(rate),
  }
}

/** Everything the leftover's suggestions need, read fresh. */
export async function readSuggestionFacts(
  db: Db,
  settings: Settings,
  today: IsoDate,
  now: Date,
  payCadence: Cadence,
): Promise<SuggestionFacts> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const profile = await getFinancialProfile(db, settings, today)
  const goals = await listGoals(db, goalReading(settings, today))
  const { debts } = await listDebts(db)
  const idle = await getIdleCash(db, settings, today, now)
  return {
    emergencyShortCents: profile.emergencyFund?.shortCents ?? null,
    goals: openGoals(goals),
    debt: costliestDebt(debts),
    retirement: retirementGap(profile, payCadence),
    idleCents: idle.suggested ? idle.idleCents : null,
  }
}
