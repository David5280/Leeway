// Sharing one calendar file's work among its repeating events, so a few
// rules that cost too much are the ones left out, never the cheap ones after
// them (a birthday listed below a thousand-year daily rule). Pure.

import type { IsoDate } from '../../lib/dates.js'
import { expandRule, workBudget, type WorkBudget } from './recurrence.js'
import type { Bounds, Rule } from './rule.js'

/** One repeating event's rule to expand: its first day, its rule and the days asked for. */
export interface RuleJob {
  first: IsoDate
  rule: Rule
  bounds: Bounds
}

/**
 * The most work any rule gets in the first round. Across the window a yearly
 * birthday needs about ten units and a weekly event a few hundred, so nearly
 * every rule finishes here; the rest (a daily one) wait for what is left over.
 */
export const FIRST_ROUND_UNITS = 1000

/**
 * One round: each rule still to expand gets an even share of what is left,
 * up to `cap`, recounted as rules finish so what one leaves goes to the next.
 * A rule that ran out of its share stays to be tried again; one offered no
 * more than it already failed with is not tried again.
 */
function round(
  jobs: RuleJob[],
  pending: number[],
  results: (IsoDate[] | null)[],
  budget: WorkBudget,
  cap: number,
  tried: number[],
): number[] {
  const unfinished: number[] = []
  pending.forEach((index, i) => {
    const share = Math.min(cap, Math.floor(budget.unitsLeft / (pending.length - i)))
    if (share <= (tried[index] ?? 0)) {
      unfinished.push(index)
      return
    }
    const job = jobs[index]!
    const attempt = workBudget(share)
    const starts = expandRule(job.first, job.rule, job.bounds, attempt)
    budget.unitsLeft -= share - attempt.unitsLeft
    tried[index] = share
    if (attempt.ranOut) unfinished.push(index)
    else results[index] = starts
  })
  return unfinished
}

/**
 * Each rule's days, in the order given, within one budget for them all; null
 * for a rule left out because it needed more than its share. Two rounds: a
 * small even share each first, then what is left shared among those that
 * needed more. The budget says when any rule was left out.
 */
export function expandAll(jobs: RuleJob[], budget: WorkBudget): (IsoDate[] | null)[] {
  const results: (IsoDate[] | null)[] = jobs.map(() => null)
  const tried: number[] = []
  let pending = jobs.map((_, index) => index)
  for (const cap of [FIRST_ROUND_UNITS, Infinity]) {
    pending = round(jobs, pending, results, budget, cap, tried)
  }
  if (pending.length) budget.ranOut = true
  return results
}
