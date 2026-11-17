// The starting-point step's logic, kept free of React so it can be tested on its own.

import type { Input } from '../../api/client'
import { parseMoney } from '../../lib/format'

export type StarterCategory = NonNullable<Input<'complete_setup'>['categories']>[number]

/** The four ways to start. */
export type Start = 'suggest' | 'starter' | 'empty' | 'import'

/** One starter category as shown in the list, with the owner's choices. */
export interface StarterRow {
  category: StarterCategory
  include: boolean
  /** The monthly budget as typed, in whole currency units. */
  amount: string
  /** What was spent per month on average, when there is bank history. */
  averageCents: number | null
}

/** What the owner changed in the list, by category name. */
export type Edits = Record<string, Partial<Pick<StarterRow, 'include' | 'amount'>>>

export interface StarterSuggestion {
  name: string
  averageMonthlyCents: number
  suggestedMonthlyCents: number
}

const toText = (cents: number | null | undefined) => (cents ? String(Math.round(cents / 100)) : '')

/**
 * Until the owner picks, suggestions from spending are the default when a bank
 * is connected (they need history), and the starter set otherwise. Null while
 * it is still unknown whether there is a bank.
 */
export function defaultStart(picked: Start | null, hasBank: boolean | undefined): Start | null {
  if (picked) return picked
  if (hasBank === undefined) return null
  return hasBank ? 'suggest' : 'starter'
}

/** The starter categories, with spending-based amounts where there are some, and the owner's edits on top. */
export function starterRows(
  starters: StarterCategory[],
  suggestions: StarterSuggestion[],
  edits: Edits,
): StarterRow[] {
  const byName = new Map(suggestions.map((s) => [s.name, s]))
  return starters.map((category) => {
    const found = byName.get(category.name)
    return {
      category,
      include: edits[category.name]?.include ?? true,
      amount:
        edits[category.name]?.amount ??
        toText(found ? found.suggestedMonthlyCents : category.budgetCents),
      averageCents: found?.averageMonthlyCents ?? null,
    }
  })
}

/** The ticked rows as categories to create. Only spending gets a budget; all are monthly. */
export function categoriesToCreate(rows: StarterRow[]): StarterCategory[] {
  return rows
    .filter((row) => row.include)
    .map((row) => ({
      ...row.category,
      budgetCents: row.category.kind === 'expense' ? parseMoney(row.amount) : null,
      budgetCadence: 'month' as const,
    }))
}
