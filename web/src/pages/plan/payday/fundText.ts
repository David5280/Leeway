// Plain words for sinking funds, kept apart from the cards so they can be
// tested alone: how often a cost comes due, what a share is a share of, and
// why a cost was suggested.

import type { SinkingFundsView } from '../../../api/client'

type Suggestion = SinkingFundsView['suggestions'][number]

/** How often a cost comes due, finishing "$780 ...". */
export const FUND_CADENCE_WORDS = { year: 'a year', quarter: 'every 3 months' } as const

/** The cadences a fund can be added with, as the picker shows them. */
export const FUND_CADENCE_CHOICES = [
  { value: 'year', label: 'Yearly' },
  { value: 'quarter', label: 'Every 3 months' },
] as const

/** What a share is a share of: "each paycheck", or each budget period while no pay is known. */
export function shareWords(view: Pick<SinkingFundsView, 'shareOf'>): string {
  return view.shareOf === 'paycheck' ? 'each paycheck' : 'each budget period'
}

/** Why a cost was suggested, in a few words. */
export function basisWords(suggestion: Pick<Suggestion, 'basis'>): string {
  switch (suggestion.basis) {
    case 'bill':
      return 'A bill you track'
    case 'repeating':
      return 'Charged on a schedule'
    case 'renewal':
      return 'Charged about a year ago'
    default:
      return 'December ran above a usual month'
  }
}
