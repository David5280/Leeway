// Plain words for the owner's pay, kept apart from the cards so they can be
// tested alone: how often it lands, where it came from, and what to call it.

import type { PayView } from '../../../api/client'

type PayInUse = NonNullable<PayView['pay']>
type Cadence = PayInUse['cadence']

/** How often pay lands, finishing "Paid ...". */
export const PAY_CADENCE_WORDS: Record<Cadence, string> = {
  week: 'every week',
  biweek: 'every 2 weeks',
  semimonth: 'twice a month',
  month: 'once a month',
  quarter: 'every 3 months',
  year: 'once a year',
}

/** The cadences an owner can enter, in the order the picker shows them. */
export const PAY_CADENCE_CHOICES = ['week', 'biweek', 'semimonth', 'month'] as const

export type PayCadenceChoice = (typeof PAY_CADENCE_CHOICES)[number]

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Who pays: the one employer, or "ACME Corp and 1 more". */
export function payerText(view: PayView): string | null {
  const employers = view.found?.employers ?? []
  if (employers.length === 0) return null
  const more = employers.length - 1
  return more === 0 ? employers[0]!.name : `${employers[0]!.name} and ${more} more`
}

/** The line under the paycheck: how often, and from whom or on whose word. */
export function payLine(view: PayView, pay: PayInUse): string {
  const often = capitalized(PAY_CADENCE_WORDS[pay.cadence])
  if (pay.source === 'yours') return `${often}, as you entered it.`
  const payer = payerText(view)
  return payer ? `${often} from ${payer}.` : `${often}.`
}

/** Where the pay came from, said so it can be trusted the right amount. */
export function sourceNote(view: PayView, pay: PayInUse): string {
  if (pay.source === 'yours') {
    return 'The pay you entered. Leeway uses it everywhere instead of what your paychecks show.'
  }
  if (pay.source === 'confirmed') return 'You said this looks right.'
  const seen = view.paydays.length
  if (pay.estimate || seen < 2) {
    return 'An estimate from one paycheck so far. It firms up after the next one, or once you say it looks right.'
  }
  return `Worked out from ${seen} paychecks. Money from people, refunds and transfers never count as pay.`
}

/** Whether to show the "Estimate" label: until the owner confirms or enters their pay. */
export function isEstimate(pay: PayInUse): boolean {
  return pay.source === 'found'
}
