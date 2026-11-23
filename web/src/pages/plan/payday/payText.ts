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

/** How often pay lands, said alone: "Every 2 weeks". */
export const cadenceLabel = (cadence: Cadence) => capitalized(PAY_CADENCE_WORDS[cadence])

/** Who pays: the one employer, or "ACME Corp and 1 more". */
export function payerText(view: PayView): string | null {
  const employers = view.found?.employers ?? []
  if (employers.length === 0) return null
  const more = employers.length - 1
  return more === 0 ? employers[0]!.name : `${employers[0]!.name} and ${more} more`
}

/** The line under the paycheck: how often, and from whom or on whose word. */
export function payLine(view: PayView, pay: PayInUse): string {
  const often = cadenceLabel(pay.cadence)
  if (pay.source === 'yours') return `${often}, as you entered it.`
  const payer = payerText(view)
  return payer ? `${often} from ${payer}.` : `${often}.`
}

/** Said when the owner confirmed pay the paychecks no longer show. */
export const STALE_NOTE = 'Your paychecks changed since you said this looked right.'

/** Where the pay came from, said so it can be trusted the right amount. */
export function sourceNote(view: PayView, pay: PayInUse): string {
  if (pay.source === 'yours') {
    return 'The pay you entered. Leeway uses it everywhere instead of what your paychecks show.'
  }
  if (pay.source === 'confirmed') {
    // The owner vouched for the main job only; a second job's guess is still one.
    const sideGuess = view.found?.employers.slice(1).some((employer) => employer.estimate)
    return sideGuess
      ? "You said this looks right. A second job's pay is an estimate until more of its paychecks land."
      : 'You said this looks right.'
  }
  const seen = view.paydays.length
  if (view.found?.confirmationStale) return `${STALE_NOTE} This is what they show now.`
  if (pay.estimate || seen < 2) {
    return 'An estimate from one paycheck so far. It firms up after the next one, or once you say it looks right.'
  }
  return `Worked out from ${seen} paychecks. Money from people, refunds and transfers never count as pay.`
}

/** Whether to show the "Estimate" label: until the owner confirms or enters their pay. */
export function isEstimate(pay: PayInUse): boolean {
  return pay.source === 'found'
}
