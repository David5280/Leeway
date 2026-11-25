// Plain words for the payday playbook, kept apart from the cards so they can
// be tested alone: how the last paycheck's leftover reads, why each idea is
// offered, and what each line of the new paycheck's plan is called.

import type { CloseOut, LeftoverSuggestion, PlanLine } from '../../../api/client'
import type { MoneyTone } from '../../../lib/money'

/** What the leftover is called: money left, or how far spending ran over. */
export function leftoverLabel(closeOut: CloseOut): string {
  return closeOut.leftoverCents < 0 ? 'Over budget by' : 'Left over'
}

/** Money left is green, spending over budget amber: a nudge, not an emergency, so never red. */
export function leftoverTone(cents: number): MoneyTone {
  if (cents > 0) return 'in'
  return cents < 0 ? 'warn' : 'neutral'
}

/** Whether the close-out has anything to show: a flexible budget, or spending in one. */
export const hasCloseOut = (closeOut: CloseOut | null): closeOut is CloseOut =>
  closeOut !== null && (closeOut.budgetedCents > 0 || closeOut.spentCents > 0)

/** Why an idea is offered, with a goal's target date in the owner's locale: "... Due Mar 1, 2027." */
export function ideaReason(idea: LeftoverSuggestion, date: (iso: string) => string): string {
  return idea.targetDate ? `${idea.reason} Due ${date(idea.targetDate)}.` : idea.reason
}

/** Each kind of plan line in everyday words. */
export const LINE_WORDS: Record<PlanLine['kind'], string> = {
  bill: 'Bill',
  set_aside: 'Goal or trip',
  sinking_fund: 'Yearly cost',
}

/** A list as people say it: "a", "a and b", "a, b and c". */
function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** What "Set aside" holds back for, from the kinds of line in it: "Goals, trips and yearly costs". */
export function setAsideWords(lines: PlanLine[]): string {
  const kinds = new Set(lines.map((line) => line.kind))
  const words = [
    ...(kinds.has('set_aside') ? ['goals', 'trips'] : []),
    ...(kinds.has('sinking_fund') ? ['yearly costs'] : []),
  ]
  const text = listWords(words)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Rent and Phone", or "Rent, Phone and 2 more" past two names. */
export function billNames(lines: PlanLine[]): string {
  const names = lines.filter((line) => line.kind === 'bill').map((line) => line.name)
  return names.length <= 2
    ? listWords(names)
    : listWords([...names.slice(0, 2), `${names.length - 2} more`])
}

/** Ideas for the leftover are suggestions only, and every card that offers them says so. */
export const SUGGESTIONS_ONLY = 'Suggestions only. You move the money yourself.'
