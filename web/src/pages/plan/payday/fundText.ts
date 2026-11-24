// Plain words for sinking funds, kept apart from the card so they can be
// tested alone: how often a cost comes due, why a cost was suggested, and
// which cost is due before its shares can cover it.

import type { SinkingFundsView } from '../../../api/client'

type Fund = SinkingFundsView['funds'][number]
type Suggestion = SinkingFundsView['suggestions'][number]

/** How often a cost comes due, finishing "$780 ...". */
export const FUND_CADENCE_WORDS = { year: 'a year', quarter: 'every 3 months' } as const

/** The cadences a fund can be added with, as the picker shows them. */
export const FUND_CADENCE_CHOICES = [
  { value: 'year', label: 'Yearly' },
  { value: 'quarter', label: 'Every 3 months' },
] as const

/** Why a cost was suggested, in a few words. */
export function basisWords(suggestion: Pick<Suggestion, 'basis'>): string {
  switch (suggestion.basis) {
    case 'bill':
      return 'A bill you track'
    case 'renewal':
      return 'Charged about a year ago'
    default:
      return 'December ran above a usual month'
  }
}

/** The soonest fund its shares will not cover in time, if any (funds come soonest due first). */
export function firstShort(view: Pick<SinkingFundsView, 'funds'>): Fund | undefined {
  return view.funds.find((fund) => fund.shortCents > 0)
}

/** What adding a suggestion sends: a bill by its id, so the fund follows it; anything else whole. */
export function suggestionInput(suggestion: Suggestion) {
  const { billId, name, amountCents, cadence, dueDate, key } = suggestion
  return billId ? { billId } : { name, amountCents, cadence, dueDate, sourceKey: key }
}
