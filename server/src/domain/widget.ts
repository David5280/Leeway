// What the home-screen widget shows: a handful of numbers the app already
// works out, read from the same domain code and cut down to the least a
// glance needs. No account names, numbers or masks, and no transaction text:
// bills go by the names the app shows (one made from a recurring charge starts
// with the bank's name for it), and alerts only as counts.

import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import { countAlerts, type AccountAlert } from './accountAlerts.js'
import { listAlerts } from './alerts.js'
import type { BudgetSummary } from './budget.js'
import { budgetSummaryWithRoom, type WithRoom } from './budgetRoom.js'
import { listBills, type Bill } from './bills.js'
import type { CashFlow } from './cashFlow.js'
import { NET_WORTH_DAYS } from './checkin.js'
import { getNetWorth, type NetWorth } from './netWorth.js'
import type { Settings } from './settings.js'

/** Bills listed at most: the large widget's short list. */
export const WIDGET_BILLS = 3

/**
 * The number the widget leads with, as the Overview does (spendable.ts): the
 * budgets' room while checking can cover it, otherwise what is safe to spend
 * until payday.
 */
export type WidgetHeadline =
  | {
      kind: 'leeway'
      /** Left in the budgets after what goals hold back; negative when over. */
      cents: number
      /** Safe to spend a day for the rest of the period, or null when nothing is left. */
      perDayCents: number | null
      /** Days left in the period, counting today. */
      daysLeft: number
    }
  | {
      kind: 'until_payday'
      /** Safe to spend until payday (see cashFlow.ts), never below zero, as the Overview shows it. */
      cents: number
      /** How far the bills due by payday outrun the cash; 0 when they fit. */
      shortfallCents: number
      perDayCents: number
      payday: IsoDate
    }

export interface WidgetSummary {
  /** Bumped only if a field changes meaning, so an older script can say it needs updating. */
  version: 1
  /** When these numbers were read. */
  asOf: string
  currency: string
  locale: string
  /** The app's theme and light or dark choice, so the widget looks like the app. */
  appearance: Pick<Settings['appearance'], 'theme' | 'mode'>
  headline: WidgetHeadline
  /** What is left in this period's budgets, or null when no budget is set. */
  budgetLeftCents: number | null
  netWorth: { cents: number; changeCents: number; sinceDays: number }
  /** The next unpaid bills, soonest (or overdue) first: the first is the next one due. */
  nextBills: { name: string; dueDate: IsoDate; overdue: boolean }[]
  /** Accounts overdrawn, over their limit or low; urgent counts the first two. */
  alerts: { count: number; urgent: number }
}

/** Everything the summary is cut from, as the domain functions return it. */
export interface WidgetSources {
  now: Date
  settings: Settings
  /** The current period's budget, with what is safe to spend beside it. */
  budget: WithRoom<BudgetSummary>
  cashFlow: CashFlow
  netWorth: NetWorth
  bills: Bill[]
  alerts: AccountAlert[]
}

/** Builds the widget's summary from what the app already worked out. Pure. */
export function widgetSummary(sources: WidgetSources): WidgetSummary {
  const { budget, netWorth, settings } = sources
  const hasBudgets = budget.totals.budgetedCents > 0
  // The earliest point in the window is what net worth was when it began.
  const startWorth = netWorth.history[0]?.netWorthCents ?? netWorth.netWorthCents
  const counts = countAlerts(sources.alerts)
  return {
    version: 1,
    asOf: sources.now.toISOString(),
    currency: settings.currency,
    locale: settings.locale,
    appearance: { theme: settings.appearance.theme, mode: settings.appearance.mode },
    headline: headlineOf(budget, sources.cashFlow),
    budgetLeftCents: hasBudgets ? budget.totals.leftCents : null,
    netWorth: {
      cents: netWorth.netWorthCents,
      changeCents: netWorth.netWorthCents - startWorth,
      sinceDays: NET_WORTH_DAYS,
    },
    nextBills: sources.bills.slice(0, WIDGET_BILLS).map((bill) => ({
      name: bill.name,
      dueDate: bill.nextDueDate,
      overdue: bill.status === 'overdue',
    })),
    alerts: {
      count: counts.overdrawn + counts.overLimit + counts.low,
      urgent: counts.overdrawn + counts.overLimit,
    },
  }
}

/** The headline, read from what can be spent now (spendable.ts): the hero's figure and its money a day. */
function headlineOf(budget: WithRoom<BudgetSummary>, cashFlow: CashFlow): WidgetHeadline {
  const room = budget.spendable
  if (room?.limitedBy === 'budget') {
    return {
      kind: 'leeway',
      cents: room.leadCents,
      perDayCents: room.leadCents > 0 ? room.perDayCents : null,
      daysLeft: budget.period.daysLeft + 1,
    }
  }
  return {
    kind: 'until_payday',
    cents: cashFlow.safeCents,
    shortfallCents: cashFlow.shortfallCents,
    perDayCents: room?.perDayCents ?? cashFlow.perDayCents,
    payday: cashFlow.nextPayday,
  }
}

/** Reads the summary for today, through the same domain functions the app's screens use. */
export async function getWidgetSummary(
  db: Db,
  settings: Settings,
  now: Date,
  today: IsoDate,
): Promise<WidgetSummary> {
  const [{ budget, cashFlow }, netWorth, bills, alerts] = await Promise.all([
    budgetSummaryWithRoom(db, settings, now),
    getNetWorth(db, today, NET_WORTH_DAYS),
    listBills(db, today),
    listAlerts(db, settings, today),
  ])
  return widgetSummary({ now, settings, budget, cashFlow, netWorth, bills, alerts })
}
