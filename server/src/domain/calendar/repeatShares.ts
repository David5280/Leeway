// Sharing one calendar file's work among its repeating events, so the rules
// that cost too much are the ones left out, never the cheap ones beside them
// (a birthday listed below a thousand-year daily rule). Pure.

import type { IsoDate } from '../../lib/dates.js'
import { expandRule, mostUnits, workBudget, type WorkBudget } from './recurrence.js'
import type { Bounds, Rule } from './rule.js'

/**
 * One event's rule to expand: its first day, its rule and the days asked
 * for. A null rule is an event that does not repeat, here only to pay for
 * its upfront work in turn; it starts once, on its first day.
 */
export interface RuleJob {
  first: IsoDate
  rule: Rule | null
  bounds: Bounds
  /** What each repeat in the bounds costs to become an event (REPEAT_UNITS). */
  unitsPerRepeat: number
  /** Work the event needs besides its rule, paid first: placing the days it skips. */
  upfrontUnits: number
}

/** The most a job's rule could cost to work out: nothing for an event that does not repeat. */
function mostOf({ first, rule, bounds, unitsPerRepeat }: RuleJob): number {
  return rule ? mostUnits(first, rule, bounds, unitsPerRepeat) : 0
}

/**
 * Each rule's days, in the order given, within one budget for them all; null
 * for a rule left out. Rules are worked out cheapest first, by the most each
 * could cost (mostUnits), each free to use all that is left: a rule costing
 * no more than that always finishes, so the budget keeps as many rules as it
 * can hold and only the costliest are left out. A rule's upfront work counts
 * toward its cost and is paid before it is worked out; an event that does
 * not repeat pays only that. When the budget cannot hold
 * them all, the first rule it cannot finish spends what is left and every
 * costlier one is left out with it; the budget says so.
 */
export function expandAll(jobs: RuleJob[], budget: WorkBudget): (IsoDate[] | null)[] {
  const results: (IsoDate[] | null)[] = jobs.map(() => null)
  const cheapestFirst = jobs
    .map((job, index) => ({ index, most: job.upfrontUnits + mostOf(job) }))
    .sort((a, b) => a.most - b.most || a.index - b.index)
  for (const { index } of cheapestFirst) {
    const job = jobs[index]!
    if (budget.unitsLeft < job.upfrontUnits) {
      budget.ranOut = true
      continue
    }
    if (!job.rule) {
      budget.unitsLeft -= job.upfrontUnits
      results[index] = [job.first]
      continue
    }
    // Its own copy of what is left, so a rule cut short is left out whole, its partial days unused.
    const attempt = workBudget(budget.unitsLeft - job.upfrontUnits)
    const starts = expandRule(job.first, job.rule, job.bounds, attempt, job.unitsPerRepeat)
    budget.unitsLeft = attempt.unitsLeft
    if (attempt.ranOut) budget.ranOut = true
    else results[index] = starts
  }
  return results
}
