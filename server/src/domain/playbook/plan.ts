// The paycheck's plan: a job for every dollar of the new paycheck and what
// was left over from the last one, in the owner's priority order. Pure.
// Suggestions only: nothing here, or anywhere, moves money.
//
// The order, most pressing first: bills due before the next payday, the
// sinking funds' share, getting an overdrawn account back to zero, everyday
// spending (the flexible budgets), goals, extra on the costliest debt,
// savings, then upcoming events (calendar data, when another part of Leeway
// provides it). Each step takes what it needs from what is still free, so a
// paycheck too small for everything leaves the later steps short, never the
// bills. Anything still free at the end goes to savings.

import type { IsoDate } from '../../lib/dates.js'

/** Every step, in priority order. */
export const STEP_KEYS = [
  'bills',
  'sinking_funds',
  'overdraft',
  'spending',
  'goals',
  'debt',
  'savings',
  'events',
] as const

export type StepKey = (typeof STEP_KEYS)[number]

/** One thing a step pays for, like a bill or a goal. */
export interface PlanItem {
  key: string
  label: string
  /** When it is due or wanted, if it has a day. */
  date: IsoDate | null
  /** A few plain words beside it, like a card's interest rate. */
  note: string | null
  amountCents: number
}

export interface PlanStep {
  key: StepKey
  /** What the step needs from this paycheck. */
  needCents: number
  /** What the plan gives it: all it needs, or what was still free. */
  amountCents: number
  items: PlanItem[]
}

/** What a step asks for. Debt's need depends on what is still free when its turn comes. */
export interface StepNeed {
  key: StepKey
  needCents: number | ((freeCents: number) => number)
  items: PlanItem[]
}

export interface PaycheckPlan {
  /** The paycheck being planned. */
  payCents: number
  /** What was left over from the last pay period; negative when spending went over. */
  leftoverCents: number
  /** What the plan shares out: the paycheck plus what was left (less, after overspending). */
  toPlanCents: number
  /** Steps that need something, in priority order. */
  steps: PlanStep[]
  /** What was still free after every step, added to savings. */
  extraCents: number
  /** What the steps needed beyond what there was to plan; 0 when everything fits. */
  shortCents: number
  /** True when even the bills before payday do not fit: the one time the plan is a problem. */
  billsShort: boolean
}

/** Debt gets this share of what is still free at its turn; savings the rest. */
export const DEBT_SHARE = 0.5

/** Suggested amounts that depend on what is free are rounded down to this. */
export const ROUND_CENTS = 1_000

/** An amount rounded down to whole ROUND_CENTS, never below zero. */
export const roundDown = (cents: number) =>
  Math.max(0, Math.floor(cents / ROUND_CENTS) * ROUND_CENTS)

/** The extra toward the costliest debt: a share of what is free, never more than is owed. */
export function debtNeed(owedCents: number): (freeCents: number) => number {
  return (freeCents) => Math.min(owedCents, roundDown(freeCents * DEBT_SHARE))
}

/** Each step's need given what is still free at its turn. */
function needOf(step: StepNeed, freeCents: number): number {
  return typeof step.needCents === 'function' ? step.needCents(freeCents) : step.needCents
}

/** A step's items, with a lone item whose amount waited on the plan (debt's) given the step's amount. */
function filledItems(items: PlanItem[], amountCents: number): PlanItem[] {
  const [only] = items
  return items.length === 1 && only!.amountCents === 0 ? [{ ...only!, amountCents }] : items
}

/** The plan for a paycheck, sharing out the paycheck and what was left over in priority order. */
export function planPaycheck(
  payCents: number,
  leftoverCents: number,
  needs: StepNeed[],
): PaycheckPlan {
  const toPlanCents = Math.max(0, payCents + leftoverCents)
  let free = toPlanCents
  let shortCents = 0
  const ordered = [...needs].sort((a, b) => STEP_KEYS.indexOf(a.key) - STEP_KEYS.indexOf(b.key))
  const steps: PlanStep[] = []
  for (const need of ordered) {
    const needCents = needOf(need, free)
    if (needCents <= 0) continue
    const amountCents = Math.min(needCents, free)
    free -= amountCents
    shortCents += needCents - amountCents
    steps.push({
      key: need.key,
      needCents,
      amountCents,
      items: filledItems(need.items, amountCents),
    })
  }
  const bills = steps.find((step) => step.key === 'bills')
  return {
    payCents,
    leftoverCents,
    toPlanCents,
    steps: withExtraSaved(steps, free),
    extraCents: free,
    shortCents,
    billsShort: bills !== undefined && bills.amountCents < bills.needCents,
  }
}

/** The steps with what is still free added to savings, making a savings step if there is none. */
function withExtraSaved(steps: PlanStep[], extraCents: number): PlanStep[] {
  if (extraCents <= 0) return steps
  const extra: PlanItem = {
    key: 'extra',
    label: 'Extra',
    date: null,
    note: null,
    amountCents: extraCents,
  }
  const savings = steps.find((step) => step.key === 'savings') ?? {
    key: 'savings' as const,
    needCents: 0,
    amountCents: 0,
    items: [],
  }
  const saved: PlanStep = {
    ...savings,
    needCents: savings.needCents + extraCents,
    amountCents: savings.amountCents + extraCents,
    items: [...savings.items, extra],
  }
  // Kept in priority order: savings goes before events.
  return [...steps.filter((step) => step !== savings), saved].sort(
    (a, b) => STEP_KEYS.indexOf(a.key) - STEP_KEYS.indexOf(b.key),
  )
}
