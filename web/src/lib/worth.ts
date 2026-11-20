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
): { cents: number; label: string } | undefined {
  return change ? { cents: change.fromCents, label: 'Where you started' } : undefined
}
