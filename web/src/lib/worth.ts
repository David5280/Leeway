// How net worth has moved over a range: where it started, how far it has
// come, and the words the net worth card and chart answer with. Pure, so the
// math is tested on its own. The figure today is the accounts' balances now,
// as the card shows it, and the start is the range's first recorded day.

import type { NetWorth } from '../api/client'

export interface WorthChange {
  /** The first day in the range a balance was known. */
  fromDate: string
  fromCents: number
  /** Today's net worth less where it started; negative when it fell. */
  changeCents: number
}

/** Where net worth started in the range and how far it moved, or null with under two days to compare. */
export function worthChange(worth: NetWorth): WorthChange | null {
  const first = worth.history[0]
  if (!first || worth.history.length < 2) return null
  return {
    fromDate: first.date,
    fromCents: first.netWorthCents,
    changeCents: worth.netWorthCents - first.netWorthCents,
  }
}

/**
 * The change in a few words: "Up" or "Down", and whether it reads as good
 * news. Holding level is fine, since nothing was lost.
 */
export function changeWords(change: WorthChange): { word: 'Up' | 'Down'; falling: boolean } {
  return change.changeCents < 0 ? { word: 'Down', falling: true } : { word: 'Up', falling: false }
}

/** The dashed level a net worth line should stay above: where it started. */
export function startReference(
  change: WorthChange | null,
): { cents: number; label: string; at: 'end' } | undefined {
  // The line starts on this level, so its words sit at the far end.
  return change ? { cents: change.fromCents, label: 'Where you started', at: 'end' } : undefined
}

/** How much further back than the shorter range, in percent, history must reach for a longer one to be worth picking. */
export const RANGE_MORE_PERCENT = 10

/**
 * Which of a list of ranges, shortest first, show more than the one before:
 * a longer range is worth picking only while history reaches meaningfully
 * further back than the shorter one (RANGE_MORE_PERCENT more days), or it
 * would draw nearly the same line. `startOf` gives the first day a range of
 * so many days covers.
 */
export function rangesWithMore(
  days: readonly number[],
  historyStart: string | null,
  startOf: (days: number) => string,
): boolean[] {
  return days.map(
    (_, i) =>
      i === 0 ||
      (historyStart !== null &&
        historyStart <= startOf(Math.ceil((days[i - 1]! * (100 + RANGE_MORE_PERCENT)) / 100))),
  )
}

/**
 * The note under a net worth chart, or null with nothing to say: where the
 * estimate from transactions ends, and where history starts when the range
 * reaches further back than it does.
 */
export function historyNote(
  worth: Pick<NetWorth, 'historyStart' | 'estimatedBefore'>,
  rangeStart: string,
  date: (iso: string) => string,
): string | null {
  const notes = []
  if (worth.estimatedBefore)
    notes.push(`Before ${date(worth.estimatedBefore)}, estimated from transactions.`)
  if (worth.historyStart && worth.historyStart > rangeStart) {
    notes.push(`History starts ${date(worth.historyStart)}.`)
  }
  return notes.length === 0 ? null : notes.join(' ')
}
