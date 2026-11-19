// Plain-language lines for a budget row: how much is left and for how long,
// what rolled over, and what to do when a category is over. Kept apart from
// the screens so every wording can be tested alone.

import type { Budget, CategoryBudget } from '../api/client'
import { shortDate } from './format'
import type { ToneText } from './goalText'

type Money = (cents: number) => string
type Period = Budget['period']

const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`

/** The day after the period's last, when every budget starts fresh. */
function resetDay(period: Period): string {
  const [year, month, day] = period.end.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

/**
 * Where a category stands, in words: "$40 left for 9 days, about $4 a day",
 * "Over by $12" or "No budget yet". Days count today, since today's
 * money can still be spent.
 */
export function budgetStatus(row: CategoryBudget, period: Period, money: Money): ToneText {
  if (row.budgetCents === null) return { text: 'No budget yet', tone: '' }
  const left = row.leftCents!
  if (left < 0) return { text: `Over by ${money(-left)}`, tone: 'over' }
  if (left === 0) return { text: 'All used for this period', tone: 'warn' }
  const ahead = row.pace === 'over' ? ', spending ahead of pace' : ''
  const tone = ahead || row.status === 'warning' ? 'warn' : ''
  if (period.offset !== 0) return { text: `${money(left)} left`, tone: '' }
  const daysToSpend = period.daysLeft + 1
  if (daysToSpend === 1) return { text: `${money(left)} left for today${ahead}`, tone }
  // Whole units, rounded down: "about $25 a day" should never add up to more than is left.
  const perDayCents = Math.floor(left / daysToSpend / 100) * 100
  // Under one unit a day rounds to "about $0 a day", which reads as nothing left.
  const perDay = perDayCents > 0 ? `, about ${money(perDayCents)} a day` : ''
  return { text: `${money(left)} left for ${days(daysToSpend)}${perDay}${ahead}`, tone }
}

/** "+$40 rolled over" or "$12 overspent last time, taken from this budget"; null without rollover. */
export function carriedText(row: CategoryBudget, money: Money): string | null {
  if (row.carriedCents === null) return null
  if (row.carriedCents > 0) return `+${money(row.carriedCents)} rolled over`
  if (row.carriedCents < 0)
    return `${money(-row.carriedCents)} overspent before, taken from this budget`
  return 'Rollover on'
}

/**
 * What to do about a category that is over: cover it from the category with
 * the most left, or raise the budget. Null unless the row is over this period.
 */
export function overHint(
  row: CategoryBudget,
  budget: Budget,
  money: Money,
  locale: string,
): string | null {
  if (row.leftCents === null || row.leftCents >= 0 || budget.period.offset !== 0) return null
  const over = -row.leftCents
  const roomiest = budget.categories
    .filter((c) => c.kind === 'expense' && c.categoryId !== row.categoryId)
    .filter((c) => c.leftCents !== null && c.leftCents >= over)
    .sort((a, b) => b.leftCents! - a.leftCents!)[0]
  const cover = roomiest
    ? `Cover the ${money(over)} from ${roomiest.name}, which has ${money(roomiest.leftCents!)} left, or raise this budget.`
    : 'Raise this budget, or ease off here for the rest of the period.'
  const after = row.rollover
    ? `With rollover on, the ${money(over)} comes out of the next budget.`
    : `It starts fresh ${shortDate(resetDay(budget.period), locale)}.`
  return `${cover} ${after}`
}
