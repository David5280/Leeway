// The cash on hand from today to payday, drawn as it drops with each bill:
// "Will the cash last until payday?" Pure. Day-to-day spending is left out,
// since the line shows what the bills leave, and the card says what that
// comes to a day. A bill already overdue counts as due today.

import type { CashFlow } from '../api/client'
import { addDays } from './dates'

export interface CashPoint {
  date: string
  cents: number
  /** The bills that come out this day, by name; empty on a day with none. */
  bills: string[]
}

/** Cash after the bills due by each day: steps down on each due date, flat between, to payday. */
export function cashPath(flow: CashFlow): CashPoint[] {
  const byDay = new Map<string, { cents: number; names: string[] }>()
  for (const bill of flow.billsDue) {
    const day = bill.dueDate < flow.today ? flow.today : bill.dueDate
    if (day > flow.nextPayday) continue
    const known = byDay.get(day) ?? { cents: 0, names: [] }
    byDay.set(day, { cents: known.cents + bill.amountCents, names: [...known.names, bill.name] })
  }
  let cents = flow.cashCents
  const points: CashPoint[] = []
  const today = byDay.get(flow.today)
  if (today) cents -= today.cents
  points.push({ date: flow.today, cents, bills: today?.names ?? [] })
  for (const [day, due] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    if (day === flow.today) continue
    // A point the day before keeps the line flat until the bill comes out.
    const before = addDays(day, -1)
    if (before > points.at(-1)!.date) points.push({ date: before, cents, bills: [] })
    cents -= due.cents
    points.push({ date: day, cents, bills: due.names })
  }
  if (points.at(-1)!.date < flow.nextPayday)
    points.push({ date: flow.nextPayday, cents, bills: [] })
  return points
}

/** The lowest the cash gets before payday, and the first day it gets there. */
export function lowestPoint(points: CashPoint[]): CashPoint {
  return points.reduce((low, point) => (point.cents < low.cents ? point : low), points[0]!)
}
