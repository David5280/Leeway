// Plain words for the payday playbook, kept apart from the cards so they can
// be tested alone: what each step of the plan is called, the few words under
// it, and how the last paycheck's leftover reads.

import type { Playbook, PlanStep } from '../../../api/client'
import type { MoneyTone } from '../../../lib/money'

type StepKey = PlanStep['key']
type CloseOut = Playbook['closeOut']

/** Each step's name, in the owner's priority order. */
export const STEP_WORDS: Record<StepKey, string> = {
  bills: 'Bills before payday',
  sinking_funds: 'Yearly costs',
  overdraft: 'Back above zero',
  spending: 'Everyday spending',
  goals: 'Goals',
  debt: 'Paying down debt',
  savings: 'Savings',
  events: 'Coming up',
}

/** Names listed in a row before the rest are counted: "Rent, Phone and 2 more". */
const NAMES_SHOWN = 2

/** A few names, then a count of the rest. */
export function namesText(names: string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(', ')
  const more = names.length - NAMES_SHOWN
  return more > 0 ? `${shown} and ${more} more` : shown
}

/**
 * The words under a step: what it pays for. Savings names its share of pay,
 * debt its card and rate; spending says when it goes by usual spending.
 */
export function stepDetail(step: PlanStep): string {
  const notes = step.items.map((item) => item.note).filter((note) => note !== null)
  switch (step.key) {
    case 'savings':
      return notes[0] ?? 'What is left'
    case 'debt': {
      const [card] = step.items
      return notes[0] ? `${card!.label}, ${notes[0]}` : card!.label
    }
    case 'spending':
      return notes.includes('usual') ? 'What you usually spend' : 'Your budgets'
    case 'overdraft':
      return 'Checking is below zero'
    default:
      return namesText(step.items.map((item) => item.label))
  }
}

/** What the leftover is called: money left, or how far spending ran over. */
export function leftoverLabel(closeOut: CloseOut): string {
  return closeOut.leftoverCents < 0 ? 'Over budget by' : 'Left over'
}

/** Money left is green, spending over budget amber: nothing is wrong yet, so never red. */
export function leftoverTone(cents: number): MoneyTone {
  if (cents > 0) return 'in'
  return cents < 0 ? 'warn' : 'neutral'
}

/** Whether the close-out has anything to show: a flexible budget, or spending in one. */
export const hasCloseOut = (closeOut: CloseOut): boolean =>
  closeOut.budgetedCents > 0 || closeOut.spentCents > 0
