// when_can_i_afford's answer for tests, from the server's own math: today's
// check stands in as a verdict and its reasons, and planPurchase works out the
// rest (how much each month, and when) for a monthly budget. Every amount is
// made up.

import type { Affordability, Verdict } from '../../../server/src/domain/afford'
import { planPurchase } from '../../../server/src/domain/purchasePlan'
import { formatCents } from '../../../server/src/lib/money'
import type { PurchasePlan } from '../pages/plan/goals/afford/affordText'
import { TODAY } from './planning'

/** Today's check of a purchase: the verdict and its reasons, with the figures beside them. */
export function checkOf(amountCents: number, verdict: Verdict, reasons: string[]): Affordability {
  return {
    verdict,
    reasons,
    amountCents,
    cashKnown: true,
    leftAfterBillsCents: 144_000 - amountCents,
    goalsSetAsideCents: 0,
    perDayBeforeCents: 14_400,
    perDayAfterCents: Math.max(0, 14_400 - Math.round(amountCents / 10)),
    categoryLeftCents: null,
    budgetLeftCents: null,
  }
}

interface PlanFacts {
  /** A typical month's surplus; null when no employer is paying. */
  surplusCents?: number | null
  surplusEstimated?: boolean
}

/** The answer for this check, saving from a $300 surplus a month unless told otherwise. */
export function affordPlan(
  check: Affordability,
  { surplusCents = 30_000, surplusEstimated = false }: PlanFacts = {},
): PurchasePlan {
  return planPurchase({
    amountCents: check.amountCents,
    savedCents: 0,
    today: TODAY,
    check,
    perPeriodCents: null,
    surplusPerPeriodCents: surplusCents,
    surplusEstimated,
    goalsNeedPerPeriodCents: 0,
    config: { kind: 'monthly', startDay: 1 },
    money: (cents) => formatCents(cents, 'USD', 'en-US'),
  })
}
