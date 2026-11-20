// What can be spent now, as every screen and summary leads with it: the
// budget's room, held to what is safe to spend before payday (cashFlow.ts).
// Pure: the budget and the cash flow come in, nothing is read here.
//
// Budget room stays budget room. When it is more than the cash can cover,
// the lesser figure leads and one short line says why, so "$1,404 left" in
// the budgets never sits beside $178 in checking unexplained.

import { addDays, type IsoDate } from '../lib/dates.js'
import { shortDate } from '../lib/words.js'
import type { BudgetSummary } from './budget.js'
import type { CashFlow } from './cashFlow.js'

type Money = (cents: number) => string

export interface Spendable {
  /** Safe to spend before payday, never below zero (see cashFlow.ts). */
  safeCents: number
  /** How far bills and overdrafts before payday outrun the cash; 0 when they fit. */
  shortfallCents: number
  /** What overdrawn checking needs to get back to zero. */
  overdraftCents: number
  /** Left in the budgets after what goals hold back; null when nothing is budgeted. */
  budgetLeftCents: number | null
  /** The figure to lead with: the lesser of the budget's room and safe to spend. */
  leadCents: number
  /** Which of the two the lead figure is. */
  limitedBy: 'budget' | 'cash'
  /** The lead figure per day, counting today, for the shorter of the period and the days to payday. */
  perDayCents: number
  /** The day money is safe to spend until, and where it came from. */
  payday: IsoDate
  paydaySource: CashFlow['paydaySource']
  paydayEstimate: boolean
  /** One short line when the budget has more room than the cash, the cash falls short or an account is overdrawn; else null. */
  note: string | null
  /** Whether the note is a problem (an overdraft or a shortfall), the only time it is red; there is always a note then. */
  problem: boolean
}

/** When money is safe to spend until, as the cash flow found it. */
type Until = Pick<Spendable, 'payday' | 'paydaySource' | 'paydayEstimate'>

/** "before payday on Nov 28", "before payday, about Nov 28", or the period's end when no payday is known. */
export function untilWords(
  { payday, paydaySource, paydayEstimate }: Until,
  locale: string,
): string {
  if (paydaySource === 'period_end') {
    // No employer paying yet: the budget period's end stands in, and the words say so.
    const end = shortDate(addDays(payday, -1), locale)
    return `by ${end}, when this budget period ends (no payday found yet)`
  }
  const day = shortDate(payday, locale)
  return paydayEstimate ? `before payday, about ${day}` : `before payday on ${day}`
}

/** The figures a note is written from. */
type NoteFacts = Until &
  Pick<Spendable, 'safeCents' | 'shortfallCents' | 'overdraftCents' | 'budgetLeftCents'>

/**
 * The one line beside the lead figure: the cash falling short, the budget
 * having more room than the cash, or an overdraft; null when none. Exported
 * so a summary can write it again with its own money format.
 */
export function spendableNote(facts: NoteFacts, money: Money, locale: string): string | null {
  const until = untilWords(facts, locale)
  if (facts.shortfallCents > 0) {
    const owed = facts.overdraftCents > 0 ? 'the bills and overdraft' : 'the bills'
    return `Checking is ${money(facts.shortfallCents)} short of ${owed} ${until}.`
  }
  const overdraft = money(facts.overdraftCents)
  if (facts.budgetLeftCents !== null && facts.budgetLeftCents > facts.safeCents) {
    const after =
      facts.overdraftCents > 0
        ? ` That is after ${overdraft} to bring an overdraft back to zero.`
        : ''
    return `Your budget has ${money(facts.budgetLeftCents)} left, but you have ${money(facts.safeCents)} you can safely spend ${until}.${after}`
  }
  // Red, so it always says why: an overdrawn account is owed back first.
  if (facts.overdraftCents > 0)
    return `An overdrawn account needs ${overdraft} to get back to zero.`
  return null
}

/** A day's room: the lesser of the budget's and the cash's, or whichever is known. */
function perDay(budgetPerDay: number | null, cashFlow: CashFlow): number {
  if (budgetPerDay === null) return cashFlow.perDayCents
  return cashFlow.cashKnown ? Math.min(budgetPerDay, cashFlow.perDayCents) : budgetPerDay
}

/**
 * The budget's room held to what is safe to spend. `budget` is the current
 * period's; its per-day room counts today, as the cash flow's does.
 */
export function spendable(
  budget: BudgetSummary,
  cashFlow: CashFlow,
  money: Money,
  locale: string,
): Spendable {
  const budgeted = budget.totals.budgetedCents > 0
  const budgetLeftCents = budgeted ? budget.totals.leewayCents : null
  // No checking balance to go by (none linked yet): the budget alone says what is left.
  const byCash =
    budgetLeftCents === null || (cashFlow.cashKnown && cashFlow.safeCents < budgetLeftCents)
  const budgetPerDay = budget.totals.safePerDayCents ?? 0
  const facts: NoteFacts = {
    safeCents: cashFlow.safeCents,
    shortfallCents: cashFlow.shortfallCents,
    overdraftCents: cashFlow.overdraftCents,
    budgetLeftCents,
    payday: cashFlow.nextPayday,
    paydaySource: cashFlow.paydaySource,
    paydayEstimate: cashFlow.paydayEstimate,
  }
  return {
    ...facts,
    leadCents: byCash ? cashFlow.safeCents : budgetLeftCents,
    limitedBy: byCash ? 'cash' : 'budget',
    perDayCents: perDay(budgeted ? budgetPerDay : null, cashFlow),
    note: cashFlow.cashKnown ? spendableNote(facts, money, locale) : null,
    // Red only for money owed back or short: an overdraft or a shortfall.
    problem: cashFlow.overdraftCents > 0 || cashFlow.shortfallCents > 0,
  }
}

/** The budget with its per-day room held to the cash, so "safe per day" means the same everywhere. */
export function withSafePerDay<B extends BudgetSummary>(budget: B, room: Spendable): B {
  if (budget.totals.safePerDayCents === null) return budget
  return { ...budget, totals: { ...budget.totals, safePerDayCents: room.perDayCents } }
}
