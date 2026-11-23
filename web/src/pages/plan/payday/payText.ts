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

type FoundEmployer = NonNullable<PayView['found']>['employers'][number]

/** What to call an employer: its name, or "Your employer" when the payer is not a business. */
export const employerLabel = (employer: FoundEmployer) => employer.name ?? 'Your employer'

/** Who pays: the one employer, or "ACME Corp and 1 more". */
export function payerText(view: PayView): string | null {
  const employers = view.found?.employers ?? []
  if (employers.length === 0) return null
  // Said mid-sentence ("from your employer"), so an unnamed payer is lower case.
  const first = employers[0]!.name ?? 'your employer'
  const more = employers.length - 1
  return more === 0 ? first : `${first} and ${more} more`
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

/** Said while a second job is still a guess, whatever the main job is. */
const SIDE_GUESS_NOTE = "A second job's pay is an estimate until more of its paychecks land."

/** Whether the main job's own reading is a guess: a second job's guess never makes it one. */
const mainIsGuess = (view: PayView) => view.found?.employers[0]?.estimate ?? false

/** A settled note, with a word that a second job is still a guess when it is. */
function withSideGuess(view: PayView, note: string): string {
  const sideGuess = view.found?.employers.slice(1).some((employer) => employer.estimate)
  return sideGuess ? `${note} ${SIDE_GUESS_NOTE}` : note
}

/** Where the pay came from, said so it can be trusted the right amount. */
export function sourceNote(view: PayView, pay: PayInUse): string {
  const seen = view.paydays.length
  if (pay.source === 'yours') {
    return 'The pay you entered. Leeway uses it everywhere instead of what your paychecks show.'
  }
  // The owner vouches for the main job only; a second job's guess is still one.
  if (pay.source === 'confirmed') return withSideGuess(view, 'You said this looks right.')
  if (view.found?.confirmationStale) return `${STALE_NOTE} This is what they show now.`
  if (seen < 2) {
    return 'An estimate from one paycheck so far. It firms up after the next one, or once you say it looks right.'
  }
  if (mainIsGuess(view)) {
    return `An estimate from ${seen} paychecks so far. It firms up as more land, or once you say it looks right.`
  }
  return withSideGuess(
    view,
    `Worked out from ${seen} paychecks. Money from people, refunds and transfers never count as pay.`,
  )
}

/** Whether to show the "Estimate" label: while the main job found is a guess the owner has not settled. */
export function isEstimate(view: PayView, pay: PayInUse): boolean {
  return pay.source === 'found' && mainIsGuess(view)
}
