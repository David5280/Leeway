// get_idle_cash: cash sitting idle in checking that could earn more in
// savings. It only reads and suggests; it never moves money.

import { z } from 'zod'
import {
  ASSUMED_SAVINGS_APY_PERCENT,
  CUSHION_DAYS,
  CUSHION_FLOOR_CENTS,
  IDLE_FLOOR_CENTS,
} from '../domain/idleCash.js'
import { getIdleCash } from '../domain/idleCashSource.js'
import { defineAction } from './action.js'
import { settingsAndToday } from './today.js'

export const getIdleCashAction = defineAction({
  name: 'get_idle_cash',
  title: 'Check for idle cash',
  description: `Whether counted checking holds well more than it needs before the next payday, and how much could sit in savings instead. Needed is the bills due before payday, typical daily spending (from the last 3 whole months) until payday, and a cushion of the larger of ${CUSHION_FLOOR_CENTS} cents and ${CUSHION_DAYS} days of spending. idleCents is what is left past that, rounded down to $100, and suggested is true only when it is at least ${IDLE_FLOOR_CENTS} cents, no account is overdrawn and safe to spend is not tight; reason says why not otherwise. yearlyInterestCents is what idleCents would earn in a year at an assumed ${ASSUMED_SAVINGS_APY_PERCENT}% APY (apyPercent): say that rate whenever quoting it. Amounts are in cents. This only suggests; it never moves money, so tell the owner to move it themselves if they want to.`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: async (ctx) => {
    const { settings, today } = await settingsAndToday(ctx)
    return getIdleCash(ctx.db, settings, today, ctx.now())
  },
})
