// The drill-down for what a credit card's balance costs in interest. Pure.

import type { DrillDown } from '../drill'
import { percentText } from '../money'

/** A card's interest: what is owed, times the APR (written as `locale` writes it), over twelve months. */
export function cardInterestDrill(
  card: {
    name: string
    balanceCents: number
    aprPercent: number
    monthlyInterestCents: number
  },
  locale: string,
): DrillDown {
  return {
    title: 'Interest on this card',
    subtitle: card.name,
    figure: { cents: card.monthlyInterestCents },
    math: {
      terms: [
        { label: 'Owed', value: { cents: card.balanceCents } },
        { label: 'APR', value: { text: percentText(card.aprPercent, locale) }, op: 'times' },
        { label: 'A year', value: { text: '12 months' }, op: 'dividedBy' },
      ],
      result: { label: 'Interest a month, about', value: { cents: card.monthlyInterestCents } },
      note: "An estimate, since the bank counts interest on each day's balance. Paying the balance in full by the due date usually costs no interest. Promo rates and when they end aren't tracked, so update the APR when yours changes.",
    },
    more: { to: '/plan/debts', label: 'Change the APR, or plan paying it off' },
  }
}
