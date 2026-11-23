// Saving a paystub the owner reviewed: the figures they confirmed, and, when
// they choose, those figures applied to a pension (pension.ts) and to the
// monthly retirement contribution. Nothing is saved until the owner says so,
// and the file itself never is.
//
// This step lives apart from paystubs.ts on purpose. pension.ts reaches the
// accounts modules through the pension store, and they reach back to
// paystubs.ts through pay/source.ts, so paystubs.ts must never import
// pension.ts (importCycles.test.ts keeps it that way).

import type pg from 'pg'
import { z } from 'zod'
import { withTransaction, type Db } from '../../db/pool.js'
import type { Pension } from '../retirement/pensions.js'
import { getSettings, mergeSettings, saveSettings } from '../settings.js'
import { applyToPension, newPaystubPensionSchema } from './pension.js'
import {
  insertPaystub,
  monthlyPlanContribution,
  paystubSchema,
  type SavedPaystub,
} from './paystubs.js'

/** Saving a paystub, and where else its figures go. */
export const savePaystubSchema = z
  .object({
    paystub: paystubSchema,
    /** The pension to update with this paystub's pension figures; null leaves every pension as it is. */
    pensionAccountId: z.uuid().nullable().default(null),
    /** A pension to add as a new account with this paystub's pension figures, in the same step. */
    newPension: newPaystubPensionSchema.nullable().default(null),
    /** An account Leeway already has to become a pension with these figures, so it counts once. */
    attachAccountId: z.uuid().nullable().default(null),
    /** Whether the 401(k), 457 and 403(b) figures become the monthly retirement contribution. */
    setRetirementContribution: z.boolean().default(false),
  })
  // At most one place for the pension figures: a kept pension, a new account or an account Leeway has.
  .refine(
    ({ pensionAccountId, newPension, attachAccountId }) =>
      [pensionAccountId, newPension, attachAccountId].filter((target) => target !== null).length <=
      1,
    {
      message:
        'Choose one pension for these figures: one you keep, a new one, or an account you have.',
      path: ['newPension'],
    },
  )

export type SavePaystub = z.infer<typeof savePaystubSchema>

/** What saving changed besides the paystub itself. */
export interface PaystubSaved {
  paystub: SavedPaystub
  /** The pension as it now stands, when one was chosen or added. */
  pension: Pension | null
  /** The monthly retirement contribution now set, when it was. */
  retirementMonthlyContributionCents: number | null
}

/** Sets the monthly retirement contribution, leaving every other assumption as it is. */
async function setRetirementContribution(db: Db, monthlyCents: number): Promise<void> {
  const settings = await getSettings(db)
  const retirement = { monthlyContributionCents: monthlyCents }
  await saveSettings(db, mergeSettings(settings, { retirement }))
}

/**
 * Saves a paystub the owner confirmed and, as they chose, applies it to a
 * pension kept already or to a new one, and to the monthly retirement
 * contribution, all or nothing.
 */
export async function savePaystub(pool: pg.Pool, input: SavePaystub): Promise<PaystubSaved> {
  return withTransaction(pool, async (db) => {
    const { paystub } = input
    const contribution = input.setRetirementContribution ? monthlyPlanContribution(paystub) : null
    const pension = await applyToPension(db, paystub, input)
    if (contribution !== null) await setRetirementContribution(db, contribution)
    return {
      paystub: await insertPaystub(db, paystub, pension?.accountId ?? null),
      pension,
      retirementMonthlyContributionCents: contribution,
    }
  })
}
