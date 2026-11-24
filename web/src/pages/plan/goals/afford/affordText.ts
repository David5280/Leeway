// Plain words for "Can I afford it?", kept apart from the card so every
// wording is tested alone. The answer comes from when_can_i_afford, which
// carries today's check (can_i_afford's verdict and reasons) and, when it
// does not fit cleanly, how long saving for it takes. Nothing here asks an AI.

import type { Output } from '../../../../api/client'
import type { GoalDraft } from '../GoalForm'

export type PurchasePlan = Output<'when_can_i_afford'>
export type Verdict = PurchasePlan['today']['verdict']

/** What was asked: the thing (which may be left blank) and its price. */
export interface Asked {
  name: string
  amountCents: number
}

/** The verdict's status color: good for yes, warn for tight, over for not yet. */
export type AnswerTone = 'good' | 'warn' | 'over' | 'muted'

/** The answer as the card says it, each part in words that stand alone. */
export interface AffordAnswer {
  /** The verdict in a word or two, colored, so color is never the only signal. */
  verdict: string
  tone: AnswerTone
  /** What was asked about, and whether it fits: "Road bike at $1,200 fits." */
  summary: string
  /** Why, from the check, the deciding reason first; each carries its numbers. */
  reasons: string[]
  /** When saving makes it fit, or why there is no date; null when it fits today. */
  when: string | null
  /** Whether to offer saving for it as a goal. */
  saveFor: boolean
}

/** The verdict's word and tone. */
const VERDICTS: Record<Verdict, { verdict: string; tone: AnswerTone }> = {
  yes: { verdict: 'Yes.', tone: 'good' },
  tight: { verdict: 'Tight.', tone: 'warn' },
  no: { verdict: 'Not yet.', tone: 'over' },
}

/** How the summary ends for each verdict. */
const FITS: Record<Verdict, string> = {
  yes: 'fits',
  tight: 'fits, but only just',
  no: 'does not fit before payday',
}

/** Said with a date read from pay that has not come often enough to be sure of. */
export const ESTIMATE_NOTE = 'That date is an estimate until pay has come a few more times.'

/** The thing and its price, or the price alone when no name was typed. */
function subject(asked: Asked, money: (cents: number) => string): string {
  const price = money(asked.amountCents)
  const name = asked.name.trim()
  return name ? `${name} at ${price}` : price
}

/**
 * When saving makes it fit: the amount each budget period and the day it is
 * saved by. With nothing over after spending and goals there is no date, so
 * a goal of its own is the way to save for it.
 */
export function whenText(
  plan: PurchasePlan,
  money: (cents: number) => string,
  date: (iso: string) => string,
  periodWord: string,
): string {
  if (plan.perPeriodCents === null || plan.affordableBy === null) {
    return `A usual ${periodWord} leaves nothing over after spending and goals yet, so saving for it as a goal is the way there.`
  }
  // An estimate only when the amount came from the usual surplus of pay still being learned.
  const estimate = plan.basis === 'recent_surplus' && plan.surplusEstimated
  const saved = `Putting aside ${money(plan.perPeriodCents)} each ${periodWord}, you could buy it by ${date(plan.affordableBy)}.`
  return estimate ? `${saved} ${ESTIMATE_NOTE}` : saved
}

/** The whole answer for what was asked. */
export function affordAnswer(
  asked: Asked,
  plan: PurchasePlan,
  money: (cents: number) => string,
  date: (iso: string) => string,
  periodWord: string,
): AffordAnswer {
  const verdict = plan.today.verdict
  // With no checking balance only the budget was weighed, so "yes" means it
  // fits the budget, not that the cash is there: say so rather than promise it.
  if (verdict === 'yes' && !plan.today.cashKnown) {
    return {
      verdict: "Can't tell yet.",
      tone: 'muted',
      summary: `${subject(asked, money)} fits the budget, but Leeway has no checking balance to weigh it against yet.`,
      // The server's one reason says the same thing, so it is not repeated.
      reasons: [],
      when: null,
      saveFor: true,
    }
  }
  const fits = verdict === 'yes'
  return {
    ...VERDICTS[verdict],
    summary: `${subject(asked, money)} ${FITS[verdict]}.`,
    reasons: plan.today.reasons,
    when: fits ? null : whenText(plan, money, date, periodWord),
    saveFor: !fits,
  }
}

/**
 * The purchase goal "Save for it" opens: the thing, its price and, when
 * saving gets there, the day it would be saved by.
 */
export function goalDraftFor(asked: Asked, plan: PurchasePlan): GoalDraft {
  return {
    name: asked.name.trim(),
    targetCents: asked.amountCents,
    // A date only when saving gets there later; "today" is no date to save toward.
    targetDate: plan.today.verdict === 'yes' ? '' : (plan.affordableBy ?? ''),
  }
}
