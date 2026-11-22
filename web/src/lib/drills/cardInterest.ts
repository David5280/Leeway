// The drill-down for what a credit card's balance costs in interest. Pure.

import type { DrillDown } from '../drill'

/** A card's interest: what is owed, times the APR, over twelve months. */
export function cardInterestDrill(card: {
  name: string
  balanceCents: number
  aprPercent: number
  monthlyInterestCents: number
}): DrillDown {
  return {
    title: 'Interest on this card',
    subtitle: card.name,
    figure: { cents: card.monthlyInterestCents },
    math: {
      terms: [
        { label: 'Owed', value: { cents: card.balanceCents } },
        { label: 'APR', value: { text: `${card.aprPercent}%` }, op: 'and' },
      ],
      result: { label: 'Interest a month, about', value: { cents: card.monthlyInterestCents } },
      note: "Owed times the APR, over 12 months: an estimate, since the bank counts interest on each day's balance. Paying the balance in full by the due date usually costs no interest.",
    },
    more: { to: '/plan/debts', label: 'Change the APR, or plan paying it off' },
  }
}
