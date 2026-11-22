// A paystub's pension figures and where they go: onto a pension the owner
// keeps already, or onto a new one added in the same step, named by the owner.
// Only figures the paystub shows are applied; nothing about a plan is guessed.

import type { z } from 'zod'
import type { Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import {
  EMPTY_PLAN,
  newPensionSchema,
  type Pension,
  type PensionPlanPatch,
} from '../retirement/pensions.js'
import { insertPension, patchPension } from '../retirement/pensionStore.js'
import { getSettings } from '../settings.js'
import type { Paystub } from './paystubs.js'

/** A pension to add from a paystub: the name the owner confirmed, and the member balance if known. */
export const newPaystubPensionSchema = newPensionSchema.pick({ name: true, balanceCents: true })

export type NewPaystubPension = z.infer<typeof newPaystubPensionSchema>

/** Where a paystub's pension figures go; with neither set, they go nowhere. */
export interface PensionTarget {
  /** A pension Leeway keeps already. */
  pensionAccountId: string | null
  /** A pension to add, holding this paystub's figures from the start. */
  newPension: NewPaystubPension | null
}

export const NO_PENSION_CONTRIBUTION =
  'This paystub shows no pension contribution, so there is no pension to add from it. Add the pension by hand instead.'

/** Whether a paystub shows the owner paying into a pension this period. */
export function showsPensionContribution(paystub: Paystub): boolean {
  return (paystub.current.pension ?? 0) > 0
}

/** A share of gross pay in percent, to two places, as the pension form takes it. */
function percentOfPay(cents: number, grossCents: number): number {
  return Math.min(100, Math.round((cents / grossCents) * 10_000) / 100)
}

/**
 * The pension details this paystub shows: what was paid in, gross pay, how
 * often pay comes, and the employer's share as a percent of gross pay. A
 * figure the paystub did not show leaves the pension's own as it is.
 */
export function pensionPatchFrom(paystub: Paystub): PensionPlanPatch {
  const { grossPay, pension, pensionEmployer } = paystub.current
  const patch: PensionPlanPatch = {}
  if (pension !== null) patch.contribution = { kind: 'amount', cents: pension }
  const hasGross = grossPay !== null && grossPay > 0
  if (hasGross) patch.grossPayCents = grossPay
  if (paystub.payCadence !== null) patch.payCadence = paystub.payCadence
  if (hasGross && pensionEmployer !== null) {
    patch.employerContributionPercent = percentOfPay(pensionEmployer, grossPay)
  }
  return patch
}

/**
 * Applies a paystub's pension figures inside the caller's transaction: to the
 * pension kept already, or to a new one added here, so a failure anywhere
 * after leaves no half-made pension behind. A new pension needs a paystub
 * that shows a pension contribution, so an empty one is never added quietly.
 * Returns the pension as it now stands, or null when none was chosen.
 */
export async function applyToPension(
  db: Db,
  paystub: Paystub,
  { pensionAccountId, newPension }: PensionTarget,
): Promise<Pension | null> {
  const patch = pensionPatchFrom(paystub)
  if (pensionAccountId !== null) return patchPension(db, pensionAccountId, patch)
  if (newPension === null) return null
  if (!showsPensionContribution(paystub)) {
    throw new AppError('invalid_input', NO_PENSION_CONTRIBUTION)
  }
  const { currency } = await getSettings(db)
  // Added empty, then given the paystub's figures through the same checked
  // merge an update uses, so no figure the pension form refuses gets stored.
  const added = await insertPension(db, { ...EMPTY_PLAN, ...newPension }, currency)
  return patchPension(db, added.accountId, patch)
}
