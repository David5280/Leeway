// The emergency fund goal's plan: one month of essential spending first, a
// target close enough to feel within reach, then three months, then six (or
// the owner's own target, when it is longer). Which accounts it counts: the
// ones the owner marked, or every savings account. Pure.

import type { AccountKind } from './accountKinds.js'
import { isCounted } from './accountSharing.js'

/** The steps every emergency fund climbs, in months of essential spending. */
const STARTER_STEPS = [1, 3, 6] as const

/** The first step: one month, small enough to start today. */
export const FIRST_STEP_MONTHS = STARTER_STEPS[0]

/** The name a new emergency fund goal takes. */
export const EMERGENCY_GOAL_NAME = 'Emergency fund'

/**
 * Every step in order. The owner's own target (savingsPlan.emergencyFundMonths)
 * joins as a last step when it reaches past six months.
 */
export function emergencySteps(ownerTargetMonths: number): number[] {
  const steps: number[] = [...STARTER_STEPS]
  if (ownerTargetMonths > steps.at(-1)!) steps.push(ownerTargetMonths)
  return steps
}

/** The step after `months`, or null once the last step is the target. */
export function nextStepMonths(months: number, ownerTargetMonths: number): number | null {
  return emergencySteps(ownerTargetMonths).find((step) => step > months) ?? null
}

/** A target in cents for some months of essential spending. */
export const targetFor = (months: number, monthlyEssentialsCents: number) =>
  months * monthlyEssentialsCents

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

/**
 * The accounts the fund counts: those the owner marked that can still hold
 * it, or, with none marked (or none left), every savings account.
 */
export function fundAccounts<A extends FundAccount>(
  accounts: A[],
  pickedIds: string[],
  currency: string,
): { accounts: A[]; picked: boolean } {
  const candidates = fundCandidates(accounts, currency)
  const picked = candidates.filter((a) => pickedIds.includes(a.id))
  if (picked.length > 0) return { accounts: picked, picked: true }
  return { accounts: candidates.filter((a) => a.kind === 'savings'), picked: false }
}

/** What the counted accounts hold together; an overdrawn one counts as nothing. */
export const fundBalance = (accounts: FundAccount[]) =>
  accounts.reduce((sum, a) => sum + Math.max(0, a.balanceCents ?? 0), 0)
