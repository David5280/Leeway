// The one place Chat answers "can I afford this?". The model calls this one
// tool for any purchase question, so the fuller answer (money already saved,
// what it takes from projected savings, or the debt it makes and how many
// pay periods it takes to clear) plugs in here, behind the same tool.
//
// For now it asks the two checks Leeway already has: can_i_afford for today,
// and when_can_i_afford for when it fits.

import { z } from 'zod'
import { runAction, defineAction } from '../actions/action.js'
import { canIAffordAction, whenCanIAffordAction } from '../actions/coach.js'
import type { AppContext } from '../context.js'

const purchaseInput = z.object({
  amountCents: z.number().int().positive(),
  categoryId: z.uuid().nullable().default(null),
  savedCents: z.number().int().min(0).default(0),
  perPeriodCents: z.number().int().positive().nullable().default(null),
})

export type PurchaseQuestion = z.output<typeof purchaseInput>

/** Today's check of a purchase and when it fits, from the existing checks. */
export async function checkPurchase(ctx: AppContext, input: PurchaseQuestion) {
  const today = await runAction(ctx, canIAffordAction, input)
  const plan = await runAction(ctx, whenCanIAffordAction, input)
  return { today, plan }
}

export const checkPurchaseTool = defineAction({
  name: 'check_purchase',
  title: 'Checking the purchase',
  description:
    'Answers "can I afford this right now?" for a purchase, as one of three outcomes. today is the check of buying it today, with reasons in plain words: verdict "yes" is paid from money already saved (it fits in the cash before payday, after the bills due by then); "tight" eats into projected savings (it fits, but pushes a budget over, dips into money held for goals, or halves the money left per day); "no" causes debt (the bills before payday would not be covered). plan says how long it takes to cover: periodsNeeded is the pay periods to repay or save it, with affordableBy and a plain message, saving at perPeriodCents if given or else the recent surplus after what goals need. Give categoryId to check that category\'s budget too, and savedCents for money already put aside toward it. Amounts are in cents. Nothing is bought or recorded.',
  input: purchaseInput,
  scope: 'read',
  surface: 'app',
  run: checkPurchase,
})
