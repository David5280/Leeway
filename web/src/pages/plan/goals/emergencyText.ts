// Plain words for the emergency fund: what counts as essential, how many
// months, and which accounts it counts. Pure, so each wording is tested alone.

import type { Output } from '../../../api/client'

export type EmergencyView = NonNullable<Output<'get_emergency_fund'>>

/** "1 month", "3 months". */
export function monthsWord(months: number): string {
  return months === 1 ? '1 month' : `${months} months`
}

/** Names in a sentence: "A", "A and B", "A, B and C". */
function listed(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** How many category names to say before "and 3 more". */
const NAMED = 3

/**
 * What the essentials are, finishing "What ... cost in a typical month":
 * "Rent, Groceries and Gas", "your bills", or "your spending".
 */
export function essentialsWords(essentials: EmergencyView['essentials']): string {
  if (!essentials || essentials.from === 'bills') return 'your bills'
  const names = essentials.categories
  if (!names || names.length === 0) return 'your spending'
  if (names.length <= NAMED) return listed(names)
  const more = names.length - NAMED
  return `${names.slice(0, NAMED).join(', ')} and ${more} more`
}

/** The accounts the fund counts, finishing "Counts ...": "every savings account", or by name. */
export function countedWords(view: EmergencyView): string {
  const counted = view.accounts.filter((account) => account.counted).map((a) => a.name)
  if (!view.picked) {
    return counted.length === 0
      ? 'your savings accounts, once you have one'
      : 'every savings account'
  }
  return listed(counted)
}
