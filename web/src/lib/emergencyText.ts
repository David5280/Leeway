// Plain words for the emergency fund: what counts as essential, how many
// months, which accounts it counts and why any is left out. Pure, so each
// wording is tested alone.

import type { Output } from '../api/client'

export type EmergencyView = NonNullable<Output<'get_emergency_fund'>>
export type FundChoice = EmergencyView['accounts'][number]

/** "1 month", "3 months", "0.5 months". */
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

/**
 * The fund's target as a badge: "3 months of essentials" for a step, or for
 * the owner's own amount that amount in months, never a step it is not.
 */
export function targetWords(view: Pick<EmergencyView, 'months' | 'ownTarget'>): string {
  if (view.months === null) return 'Your own target'
  if (view.ownTarget) return `About ${monthsWord(view.months)} of essentials`
  return `${monthsWord(view.months)} of essentials`
}

/** The accounts the fund counts now. */
export function countedAccounts(view: EmergencyView): FundChoice[] {
  return view.accounts.filter((account) => account.counted)
}

/**
 * Where the fund's progress comes from, finishing "Counts ...": "every
 * savings account", the accounts by name, or what is added by hand.
 */
export function countedWords(view: EmergencyView): string {
  const counted = countedAccounts(view).map((a) => a.name)
  switch (view.counts) {
    case 'hand':
      return 'what you add by hand'
    case 'account':
    case 'marked':
      return counted.length === 0 ? 'none of the accounts you picked yet' : listed(counted)
    case 'savings': {
      if (counted.length > 0) return 'every savings account'
      // Every savings account there is may be one another goal follows.
      const followed = view.accounts.some((a) => a.leftOut === 'other_goal')
      return followed ? 'no savings account yet' : 'your savings accounts, once you have one'
    }
  }
}

/** Why one account is left out, as a sentence; null when it is not, or nothing needs saying. */
function leftOutSentence(account: FundChoice): string | null {
  switch (account.leftOut) {
    case 'other_goal':
      return `${account.name} is left out, since ${account.otherGoal} follows it.`
    // The rest show only for accounts the owner marked, so they hear why a pick counts nothing.
    case 'hidden':
      return `${account.name} is hidden, so it counts nothing until you show it again.`
    case 'not_shared':
      return `${account.name} is no longer shared with Leeway, so it counts nothing.`
    case 'unavailable':
      return `${account.name} has no balance Leeway can count yet.`
    default:
      return null
  }
}

/** A sentence for each account the fund leaves out that the owner should hear about. */
export function leftOutNotes(view: EmergencyView): string[] {
  // Counting by hand, no account is in play, so none is left out.
  if (view.counts === 'hand') return []
  return view.accounts.map(leftOutSentence).filter((note) => note !== null)
}

/** The hint by the fund's target in the goal's form: how it is sized, and how to change that. */
export function fundTargetHint(view: EmergencyView): string {
  if (view.ownTarget) return 'Your own amount. Pick a step on the card to size it by essentials.'
  return 'Sized by essentials. Type an amount to set your own.'
}

/**
 * The hint when another goal is set to follow an account the fund counts:
 * following it leaves it out of the fund. Null when it does not.
 */
export function followHint(
  view: EmergencyView | null,
  goalId: string | null,
  accountId: string,
): string | null {
  // Only a fund counts accounts; the offer only adds up what savings holds.
  if (!view || view.goalId === null || view.goalId === goalId) return null
  const account = countedAccounts(view).find((one) => one.id === accountId)
  if (!account) return null
  return `Your emergency fund counts ${account.name} now. Following it here leaves it out of the fund.`
}
