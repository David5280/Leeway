// The emergency fund goal's plan: one month of essential spending first, a
// target close enough to feel within reach, then three months, then six, each
// stopping at the owner's own target. Which goal is the fund, and which
// accounts it counts: the ones the owner marked, or every savings account,
// never one another goal already follows. Pure.

import type { AccountKind } from './accountKinds.js'
import { isCounted, isShared } from './accountSharing.js'

/** The steps every emergency fund climbs, in months of essential spending. */
const STARTER_STEPS = [1, 3, 6] as const

/** The first step: one month, small enough to start today. */
export const FIRST_STEP_MONTHS = STARTER_STEPS[0]

/** The name a new emergency fund goal takes. */
export const EMERGENCY_GOAL_NAME = 'Emergency fund'

/**
 * Every step in order, up to the owner's own target
 * (savingsPlan.emergencyFundMonths), which is always the last: a target of
 * four months climbs 1, 3, 4 and a target of twelve climbs 1, 3, 6, 12.
 */
export function emergencySteps(ownerTargetMonths: number): number[] {
  const below = STARTER_STEPS.filter((step) => step < ownerTargetMonths)
  return [...below, ownerTargetMonths]
}

/** The step after `months`, or null once the fund aims at the owner's target or past it. */
export function nextStepMonths(months: number, ownerTargetMonths: number): number | null {
  return emergencySteps(ownerTargetMonths).find((step) => step > months) ?? null
}

/** A target in cents for some months of essential spending. */
export const targetFor = (months: number, monthlyEssentialsCents: number) =>
  months * monthlyEssentialsCents

/** How many months of essentials an amount is, to one decimal: "about 1.2 months". */
export const monthsOf = (cents: number, monthlyEssentialsCents: number) =>
  Math.round((cents / monthlyEssentialsCents) * 10) / 10

/**
 * A whole name that says "this is my emergency fund": "Emergency fund",
 * "Emergency savings" or "Rainy day" (also "rainy-day"), maybe after "My" and
 * before "fund", "savings", "account" or "pot". The whole name has to match,
 * so "Not an emergency fund" and "Rainy day trip to Seattle" are other goals,
 * and so is "Emergency funds", which sounds like more than one.
 */
const FUND_NAME =
  /^(my\s+)?(emergency\s+(fund|savings)|rainy(\s+|-)day)(\s+(fund|savings|account|pot))?$/i

/**
 * Whether a goal's name says it is an emergency fund (FUND_NAME), in any case
 * and ignoring spaces around it. A goal the owner made by hand with such a
 * name is taken as the fund, so no second one is offered.
 */
export function namesEmergencyFund(name: string): boolean {
  return FUND_NAME.test(name.trim())
}

/** What finding the fund reads of each goal. */
interface FundCandidateGoal {
  name: string
  emergencyMonths: number | null
}

/**
 * The emergency fund among the goals: the one marked as the fund, or else the
 * first one named as an emergency fund, taken as it is. Null with neither.
 */
export function findFund<G extends FundCandidateGoal>(goals: G[]): G | null {
  return (
    goals.find((goal) => goal.emergencyMonths !== null) ??
    goals.find((goal) => namesEmergencyFund(goal.name)) ??
    null
  )
}

/**
 * Where the fund's progress comes from: every savings account, the accounts
 * the owner marked, the one account its form links, or a count kept by hand
 * (a goal made that way before it was taken as the fund).
 */
export type FundCounts = 'savings' | 'marked' | 'account' | 'hand'

/** What choosing the accounts an emergency fund counts reads from each account. */
export interface FundAccount {
  id: string
  kind: AccountKind
  hidden: boolean
  unsharedAt: string | null
  balanceCents: number | null
  currency: string
}

/**
 * The accounts that can hold an emergency fund: cash the owner can reach in a
 * day, so savings and checking, counted (not hidden, still shared), in the
 * owner's currency and with a known balance.
 */
export function fundCandidates<A extends FundAccount>(accounts: A[], currency: string): A[] {
  return accounts.filter(
    (a) =>
      (a.kind === 'savings' || a.kind === 'checking') &&
      isCounted(a) &&
      a.currency === currency &&
      a.balanceCents !== null,
  )
}

/** The accounts the owner marked for the fund, and those other goals follow. */
export interface FundLinks {
  markedIds: string[]
  /** Accounts other goals follow, which the fund leaves out so no money counts twice. */
  otherGoalAccountIds: string[]
}

/** What is stored about a fund beyond its goal: the accounts it links, and whose target it is. */
export interface FundState extends FundLinks {
  /** The owner's own target amount, rather than months of essentials. */
  ownTarget: boolean
}

/**
 * The accounts the fund counts. With accounts marked, only those that can
 * still hold it: a marked account that is hidden or followed by another goal
 * is left out and shown as such, never swapped for every savings account
 * behind the owner's back. With none marked, every savings account no other
 * goal follows.
 */
export function fundAccounts<A extends FundAccount>(
  accounts: A[],
  { markedIds, otherGoalAccountIds }: FundLinks,
  currency: string,
): { accounts: A[]; counts: 'marked' | 'savings' } {
  const free = fundCandidates(accounts, currency).filter((a) => !otherGoalAccountIds.includes(a.id))
  if (markedIds.length > 0) {
    return { accounts: free.filter((a) => markedIds.includes(a.id)), counts: 'marked' }
  }
  return { accounts: free.filter((a) => a.kind === 'savings'), counts: 'savings' }
}

/**
 * What the counted accounts hold together. An overdrawn account counts as
 * nothing rather than taking from the others, as a goal following one
 * account does: the fund is money put by, and an overdraft is not negative
 * savings. The financial profile counts the fund the same way.
 */
export const fundBalance = (accounts: Pick<FundAccount, 'balanceCents'>[]) =>
  accounts.reduce((sum, a) => sum + Math.max(0, a.balanceCents ?? 0), 0)

/** Why an account the fund could hold is left out, or null when it can be counted. */
export type LeftOut = 'hidden' | 'not_shared' | 'other_goal' | 'unavailable'

/** One account on the fund's list, with whether it counts now and why not. */
export interface FundChoice {
  id: string
  name: string
  /** Null while the account has no balance yet. */
  balanceCents: number | null
  /** Whether the fund counts it now. */
  counted: boolean
  /** Whether the owner marked it (or linked it in the goal's form). */
  marked: boolean
  leftOut: LeftOut | null
  /** For an account another goal follows, that goal's name. */
  otherGoal: string | null
}

/** Why an account is left out of the fund, checked in the order the owner can act on. */
function leftOutOf(
  account: FundAccount,
  currency: string,
  otherGoal: string | null,
): LeftOut | null {
  if (account.hidden) return 'hidden'
  if (!isShared(account)) return 'not_shared'
  if (otherGoal !== null) return 'other_goal'
  if (account.currency !== currency || account.balanceCents === null) return 'unavailable'
  return null
}

/**
 * Every checking and savings account the fund's list shows: the ones it can
 * count, the ones other goals follow (so the owner sees why they are out),
 * and any marked account that can't be counted now, like a hidden one.
 */
export function fundChoices<A extends FundAccount & { name: string }>(
  accounts: A[],
  links: { markedIds: string[]; countedIds: string[]; otherGoals: Map<string, string> },
  currency: string,
): FundChoice[] {
  return accounts
    .filter((a) => a.kind === 'savings' || a.kind === 'checking')
    .map((a) => {
      const otherGoal = links.otherGoals.get(a.id) ?? null
      return {
        id: a.id,
        name: a.name,
        balanceCents: a.balanceCents,
        counted: links.countedIds.includes(a.id),
        marked: links.markedIds.includes(a.id),
        leftOut: leftOutOf(a, currency, otherGoal),
        otherGoal,
      }
    })
    .filter((choice) => {
      // A hidden or unusable account is noise unless the owner marked it.
      const shown = choice.leftOut === null || choice.leftOut === 'other_goal'
      return shown || choice.marked
    })
}

/** Why the fund can't count an account: another goal follows it, and a dollar counts toward one goal. */
export const followedAlready = (goal: string) =>
  `${goal} follows that account already, so the emergency fund can't count it too`

/** What finding the accounts other goals follow reads of each goal. */
interface FollowingGoal {
  id: string
  name: string
  accountId: string | null
}

/** The accounts goals other than the fund follow, each with the goal's name. */
export function accountsOtherGoalsFollow(
  goals: FollowingGoal[],
  fundId: string | null,
): Map<string, string> {
  const followed = new Map<string, string>()
  for (const goal of goals) {
    if (goal.id !== fundId && goal.accountId !== null && !followed.has(goal.accountId)) {
      followed.set(goal.accountId, goal.name)
    }
  }
  return followed
}

/** What working out the fund's savings reads of each goal. */
interface SavingGoal extends FundCandidateGoal, FollowingGoal {
  currentCents: number
}

/**
 * What the emergency fund holds now: its goal's progress, as the goals list
 * counts it, or with no fund yet every savings account no goal follows. The
 * fund's card and the financial profile both read the fund through this, so
 * they never disagree.
 */
export function emergencySavedCents(
  goals: SavingGoal[],
  accounts: FundAccount[],
  currency: string,
): number {
  const fund = findFund(goals)
  if (fund !== null) return fund.currentCents
  const otherGoalAccountIds = [...accountsOtherGoalsFollow(goals, null).keys()]
  return fundBalance(
    fundAccounts(accounts, { markedIds: [], otherGoalAccountIds }, currency).accounts,
  )
}

/**
 * What the emergency fund holds for the financial profile: as emergencySavedCents,
 * or null with neither a fund nor a savings account, when there is no fund to speak of.
 */
export function fundSaved(
  goals: SavingGoal[],
  accounts: FundAccount[],
  currency: string,
  hasSavingsAccount: boolean,
): number | null {
  if (findFund(goals) === null && !hasSavingsAccount) return null
  return emergencySavedCents(goals, accounts, currency)
}
