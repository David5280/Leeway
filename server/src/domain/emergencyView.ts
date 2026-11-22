// The emergency fund as its card and an assistant read it: the fund once
// there is one (marked, or a goal named as one), or the one-tap offer, with
// the step it aims for, the next step, and every account it could count.
// Pure: emergencyGoal.ts reads what it needs and hands it here.

import type { Account } from './accounts.js'
import {
  accountsOtherGoalsFollow,
  emergencySavedCents,
  findFund,
  FIRST_STEP_MONTHS,
  fundAccounts,
  fundChoices,
  monthsOf,
  nextStepMonths,
  targetFor,
  type FundChoice,
  type FundCounts,
} from './emergencyPlan.js'
import type { Goal } from './goalProgress.js'
import type { MonthlyEssentials } from './monthlyEssentials.js'
import { monthsCovered } from './savings/emergency.js'
import type { Settings } from './settings.js'

/** The emergency fund as the Goals screen and an assistant read it. */
export interface EmergencyFundView {
  /** The fund's goal; null while it is only offered. */
  goalId: string | null
  /** Essential spending a month; null when not known yet (only possible once started). */
  essentials: MonthlyEssentials | null
  /**
   * How many months of essentials the target is: the step it aims for (1
   * when offered), or for the owner's own amount that amount in months, to one
   * decimal. Null for the owner's own amount while essentials are unknown.
   */
  months: number | null
  /** Whether the target is the owner's own amount, rather than months of essentials. */
  ownTarget: boolean
  targetCents: number
  /** What the fund holds now, as its goal counts it. */
  savedCents: number
  /** Months of essentials that covers, as the financial profile says it; null without essentials. */
  monthsCovered: number | null
  /** The step after this one, or null at the last. */
  next: { months: number; targetCents: number } | null
  /** Where its progress comes from (see FundCounts). */
  counts: FundCounts
  /** Every account it could count, and why any is left out. */
  accounts: FundChoice[]
}

/** What the view is worked out from. */
export interface EmergencyViewInput {
  goals: Goal[]
  essentials: MonthlyEssentials | null
  /** Every account, hidden ones included, so a hidden marked account shows as such. */
  accounts: Account[]
  /** The fund's stored state; nothing marked and no own target for the offer or a named goal. */
  state: { markedIds: string[]; ownTarget: boolean }
  settings: Pick<Settings, 'currency' | 'savingsPlan'>
}

/** Where the fund's progress comes from. */
function countsOf(fund: Goal | null, markedIds: string[]): FundCounts {
  if (fund === null) return 'savings'
  if (fund.accountId !== null) return 'account'
  // A fund that follows no accounts of its own keeps the count it had by hand.
  if (fund.followedAccountIds === null) return 'hand'
  return markedIds.length > 0 ? 'marked' : 'savings'
}

/** The step after `months`, sized from essentials; null without essentials or past the last step. */
function nextStep(
  months: number | null,
  essentials: MonthlyEssentials | null,
  ownerTargetMonths: number,
): EmergencyFundView['next'] {
  if (months === null || essentials === null) return null
  const next = nextStepMonths(months, ownerTargetMonths)
  return next === null ? null : { months: next, targetCents: targetFor(next, essentials.cents) }
}

/**
 * The target in months and cents: the offer's first step, the step a fund
 * aims for, or the owner's own amount told in months. Null for an offer with
 * no essentials to size it by.
 */
function targetOf(
  fund: Goal | null,
  ownTarget: boolean,
  essentials: MonthlyEssentials | null,
): { months: number | null; targetCents: number } | null {
  if (fund === null) {
    if (essentials === null) return null
    return {
      months: FIRST_STEP_MONTHS,
      targetCents: targetFor(FIRST_STEP_MONTHS, essentials.cents),
    }
  }
  if (ownTarget) {
    const months = essentials === null ? null : monthsOf(fund.targetCents, essentials.cents)
    return { months, targetCents: fund.targetCents }
  }
  return { months: fund.emergencyMonths, targetCents: fund.targetCents }
}

/**
 * The emergency fund, or its offer, as of now. Null with no fund while
 * essential spending is unknown, since there is nothing to size an offer by.
 */
export function emergencyView({
  goals,
  essentials,
  accounts,
  state,
  settings,
}: EmergencyViewInput): EmergencyFundView | null {
  const fund = findFund(goals)
  // A goal named as a fund and never marked keeps the target it was given.
  const ownTarget = fund !== null && (fund.emergencyMonths === null || state.ownTarget)
  const target = targetOf(fund, ownTarget, essentials)
  if (target === null) return null
  const otherGoals = accountsOtherGoalsFollow(goals, fund?.id ?? null)
  const counts = countsOf(fund, state.markedIds)
  const counted = fundAccounts(
    accounts,
    { markedIds: state.markedIds, otherGoalAccountIds: [...otherGoals.keys()] },
    settings.currency,
  ).accounts
  const linked = fund?.accountId ?? null
  const followsAccounts = counts === 'savings' || counts === 'marked'
  const countedIds = followsAccounts
    ? counted.map((a) => a.id)
    : [linked].filter((id) => id !== null)
  const savedCents = emergencySavedCents(goals, accounts, settings.currency)
  const { months, targetCents } = target
  return {
    goalId: fund?.id ?? null,
    essentials,
    months,
    ownTarget,
    targetCents,
    savedCents,
    monthsCovered: essentials === null ? null : monthsCovered(savedCents, essentials.cents),
    next: nextStep(months, essentials, settings.savingsPlan.emergencyFundMonths),
    counts,
    accounts: fundChoices(
      accounts,
      {
        // The one account the goal's form links counts as marked, so the form starts on it.
        markedIds: linked === null ? state.markedIds : [linked],
        countedIds,
        otherGoals,
      },
      settings.currency,
    ),
  }
}
