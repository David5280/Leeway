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
  /**
   * What can be spent a day, counting today: the lesser of the budget's room
   * a day for the rest of the period and the cash's a day until payday (see
   * dailyRoom). Every surface that says "a day" quotes this.
   */
  perDayCents: number
  /** Whether a checking balance is known; without one the budget leads and the cash is not judged. */
  cashKnown: boolean
  /** The day money is safe to spend until, and where it came from. */
  payday: IsoDate
  paydaySource: CashFlow['paydaySource']
  paydayEstimate: boolean
  /**
   * One short line when the cash leads or falls short: the budget having
   * more room than the cash, the bills outrunning it, or, with no budget to
   * compare, an overdraft. Null when the budget leads and the cash covers it.
   */
  note: string | null
  /** Whether the note is a problem (a shortfall, or an overdraft while the cash leads), the only time it is red; there is always a note then. */
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
export type NoteFacts = Until &
  Pick<
    Spendable,
    'safeCents' | 'shortfallCents' | 'overdraftCents' | 'budgetLeftCents' | 'limitedBy'
  > & {
    /** Whether goals hold some of the budget back, so its room is said to be after them. */
    afterGoals: boolean
  }

/**
 * The one line beside the lead figure: the cash falling short, the budget
 * having more room than the cash, or, with no budget, an overdraft; null
 * when none. Exported so a summary can write it again with its own money
 * format.
 */
export function spendableNote(facts: NoteFacts, money: Money, locale: string): string | null {
  const until = untilWords(facts, locale)
  if (facts.shortfallCents > 0) {
    const owed = facts.overdraftCents > 0 ? 'the bills and overdraft' : 'the bills'
    return `Checking is ${money(facts.shortfallCents)} short of ${owed} ${until}.`
  }
  const overdraft = money(facts.overdraftCents)
  if (facts.budgetLeftCents !== null && facts.budgetLeftCents > facts.safeCents) {
    const afterGoals = facts.afterGoals ? ' after goals' : ''
    const afterOverdraft =
      facts.overdraftCents > 0
        ? ` That is after ${overdraft} to bring an overdraft back to zero.`
        : ''
    return `Your budget has ${money(facts.budgetLeftCents)} left${afterGoals}, but you have ${money(facts.safeCents)} you can safely spend ${until}.${afterOverdraft}`
  }
  // Only while the cash leads, where its figure is red and needs its why;
  // otherwise the overdrawn account's own alert says it.
  if (facts.overdraftCents > 0 && facts.limitedBy === 'cash')
    return `An overdrawn account needs ${overdraft} to get back to zero.`
  return null
}

/** How much room there is, and over how many days (counting today) it has to last. */
interface Room {
  cents: number
  days: number
}

/**
 * A day's room, counting today: the lesser of the budget's room a day for
 * the rest of the period and the cash's a day until payday, or whichever is
 * known; never below zero. `budget` is null when nothing is budgeted, and
 * `cash` when no checking balance is known.
 */
export function dailyRoom(budget: Room | null, cash: Room | null): number {
  const aDay = ({ cents, days }: Room) => Math.max(0, Math.floor(cents / Math.max(1, days)))
  const each = [budget, cash].filter((room) => room !== null).map(aDay)
  return each.length ? Math.min(...each) : 0
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
  const limitedBy: Spendable['limitedBy'] = byCash ? 'cash' : 'budget'
  const shown = {
    safeCents: cashFlow.safeCents,
    shortfallCents: cashFlow.shortfallCents,
    overdraftCents: cashFlow.overdraftCents,
    budgetLeftCents,
    limitedBy,
    payday: cashFlow.nextPayday,
    paydaySource: cashFlow.paydaySource,
    paydayEstimate: cashFlow.paydayEstimate,
  } satisfies Omit<NoteFacts, 'afterGoals'>
  const afterGoals = budget.totals.setAsideCents > 0
  const note = cashFlow.cashKnown ? spendableNote({ ...shown, afterGoals }, money, locale) : null
  // Red only for money short, or owed back while the cash leads: there is a note then.
  const owedWhileCashLeads = limitedBy === 'cash' && cashFlow.overdraftCents > 0
  return {
    ...shown,
    leadCents: limitedBy === 'cash' ? cashFlow.safeCents : budgetLeftCents!,
    perDayCents: dailyRoom(
      budgetLeftCents === null
        ? null
        : { cents: budgetLeftCents, days: budget.period.daysLeft + 1 },
      cashFlow.cashKnown ? { cents: cashFlow.safeCents, days: cashFlow.daysUntilPayday } : null,
    ),
    cashKnown: cashFlow.cashKnown,
    note,
    problem: note !== null && (cashFlow.shortfallCents > 0 || owedWhileCashLeads),
  }
}

/** The budget with its per-day room held to the cash, so "safe per day" means the same everywhere. */
export function withSafePerDay<B extends BudgetSummary>(budget: B, room: Spendable): B {
  if (budget.totals.safePerDayCents === null) return budget
  return { ...budget, totals: { ...budget.totals, safePerDayCents: room.perDayCents } }
}
