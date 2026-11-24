// Will checking go below zero before payday, and what would cover it? Read
// straight from the cash flow (cashFlow.ts), the one engine behind safe to
// spend and the Plan's line to payday, so the warning can never disagree
// with either: checking starts at what it holds now, less any overdraft, and
// steps down with each bill on its due date (an overdue one today). Day to
// day spending is left out, as it is for safe to spend. Pure. Suggestions
// only: nothing here, or anywhere, moves money.

import { addDays, type IsoDate } from '../lib/dates.js'
import type { CashFlow } from './cashFlow.js'

/** A savings account that could cover a shortfall, and what it holds. */
export interface SavingsSource {
  accountName: string
  cashCents: number
}

/** The move that would keep checking at or above zero until payday. */
export interface Cover {
  /** The shortfall rounded up to COVER_ROUND_CENTS, so it reads as a plain amount with a little room. */
  amountCents: number
  /** Move it by this day: the day before checking goes below zero, or today. */
  byDate: IsoDate
  /** The savings account that holds enough, or null when none does. */
  fromAccountName: string | null
}

export interface BelowZero {
  /** The first day checking is below zero: today when it is already. */
  date: IsoDate
  /** Already below zero today, rather than heading there. */
  now: boolean
  /** The bills that take it below zero that day; empty when it is already. */
  bills: string[]
  /** How far below zero it gets by payday: the cash flow's shortfall. */
  shortCents: number
  cover: Cover
}

/** A move is rounded up to this. */
export const COVER_ROUND_CENTS = 1_000

type Flow = Pick<CashFlow, 'today' | 'cashCents' | 'overdraftCents' | 'billsDue' | 'shortfallCents'>

/**
 * The first day checking goes below zero, and the bills due that day. The
 * caller knows it does: a shortfall means the bills outrun the cash.
 */
function firstDayBelow(flow: Flow): Pick<BelowZero, 'date' | 'now' | 'bills'> {
  let cents = flow.cashCents - flow.overdraftCents
  if (cents < 0) return { date: flow.today, now: true, bills: [] }
  // An overdue bill comes out today. billsDue is soonest first already.
  const byDay = new Map<IsoDate, { cents: number; names: string[] }>()
  for (const bill of flow.billsDue) {
    const day = bill.dueDate < flow.today ? flow.today : bill.dueDate
    const known = byDay.get(day) ?? { cents: 0, names: [] }
    byDay.set(day, { cents: known.cents + bill.amountCents, names: [...known.names, bill.name] })
  }
  for (const [date, due] of byDay) {
    cents -= due.cents
    if (cents < 0) return { date, now: false, bills: due.names }
  }
  // Unreachable while shortfallCents agrees with the bills; today is the cautious answer.
  return { date: flow.today, now: false, bills: [] }
}

/** The shortfall rounded up to the next COVER_ROUND_CENTS. */
export const coverAmount = (shortCents: number) =>
  Math.ceil(shortCents / COVER_ROUND_CENTS) * COVER_ROUND_CENTS

/**
 * When checking goes below zero before payday and the move that covers it,
 * from the savings account holding the most, if any holds enough. Null when
 * checking lasts, or its balance is not known.
 */
export function belowZero(flow: Flow, savings: SavingsSource[]): BelowZero | null {
  // The cash flow says 0 both when the bills fit and when the cash is unknown.
  if (flow.shortfallCents <= 0) return null
  const { date, now, bills } = firstDayBelow(flow)
  const amountCents = coverAmount(flow.shortfallCents)
  const from = savings
    .filter((account) => account.cashCents >= amountCents)
    .sort((a, b) => b.cashCents - a.cashCents)[0]
  return {
    date,
    now,
    bills,
    shortCents: flow.shortfallCents,
    cover: {
      amountCents,
      byDate: date > flow.today ? addDays(date, -1) : flow.today,
      fromAccountName: from?.accountName ?? null,
    },
  }
}
