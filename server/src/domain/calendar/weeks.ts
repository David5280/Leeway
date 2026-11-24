// The forecast's items and how they sort into weeks from today. Pure, so the
// web app's tests build forecasts with the same code.

import { addDays, type IsoDate } from '../../lib/dates.js'
import type { EventKind } from './kinds.js'

/** How far ahead the forecast looks: six weeks. */
export const FORECAST_WEEKS = 6

export type ForecastItem =
  | { type: 'payday'; date: IsoDate; amountCents: number | null }
  | {
      type: 'bill'
      /** The day it is due; before today when it is overdue. */
      date: IsoDate
      billId: string
      name: string
      amountCents: number
      /** Its due day passed with no payment found. */
      overdue?: true
    }
  | {
      type: 'event'
      /** Stable and unique among events: two on one day of one kind are still told apart. */
      id: string
      date: IsoDate
      endsOn: IsoDate
      title: string
      kind: EventKind
      /**
       * What to set aside, from what past events of this kind cost less what
       * was spent on this one already: 0 when nothing is left to set aside
       * (or a trip budget saves for it), null without enough history to tell.
       */
      suggestedCents: number | null
      /** How many past events the suggestion comes from. */
      basedOn: number
      /** A trip with a page of its own, where its budget is planned: the row opens it. */
      tripPage?: true
      /** A trip budget shares its days, so its goal saves for it and nothing more is suggested. */
      budgeted?: true
    }

export interface ForecastWeek {
  /** The week's first day; weeks run seven days from today. */
  start: IsoDate
  end: IsoDate
  items: ForecastItem[]
  billsCents: number
  setAsideCents: number
}

export interface Forecast {
  connected: boolean
  today: IsoDate
  weeks: ForecastWeek[]
  /** What to note about the calendar's last read (repeating events left out); null when nothing. */
  note: string | null
}

/** Items sorted into weeks of seven days from today. */
export function intoWeeks(items: ForecastItem[], today: IsoDate): ForecastWeek[] {
  const order = { payday: 0, bill: 1, event: 2 }
  const sorted = [...items].sort(
    (a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type],
  )
  return Array.from({ length: FORECAST_WEEKS }, (_, i) => {
    const start = addDays(today, i * 7)
    const end = addDays(start, 6)
    // An event already under way, or a bill overdue, belongs to the first week.
    const inWeek = sorted.filter((item) =>
      i === 0 ? item.date <= end : item.date >= start && item.date <= end,
    )
    return {
      start,
      end,
      items: inWeek,
      billsCents: inWeek.reduce(
        (sum, item) => sum + (item.type === 'bill' ? item.amountCents : 0),
        0,
      ),
      setAsideCents: inWeek.reduce(
        (sum, item) => sum + (item.type === 'event' ? (item.suggestedCents ?? 0) : 0),
        0,
      ),
    }
  })
}
