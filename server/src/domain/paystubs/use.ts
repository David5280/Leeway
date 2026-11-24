// What Leeway uses from the newest paystub, for the Settings screen that
// imports one: where it stands, the figures the financial profile reads from
// it (applied.ts), and whether its take-home now stands for a paycheck
// (pay/paystubPay.ts). Pure. Totals only: never the employer, an account or
// member number, or anything else that names someone.

import type { IsoDate } from '../../lib/dates.js'
import type { FinancialProfile } from '../profile/profile.js'
import { freshPaystub, paystubDate } from '../savings/payrollMonths.js'
import type { PaystubFigures } from './applied.js'
import type { SavedPaystub } from './paystubs.js'

/**
 * Where the newest paystub stands:
 * - none: no paystub saved yet
 * - used: a recent paystub confirmed line by line, its figures in use
 * - stale: the newest paystub is too old to say what pay takes now
 * - partial: the newest is recent but was saved for a pension only, without
 *   every line, so only its pension and plan figures count
 */
export type PaystubUseState = 'none' | 'used' | 'stale' | 'partial'

export interface PaystubUse {
  state: PaystubUseState
  /** The day the newest paystub is from: its pay date, or the day it was saved. Null with none. */
  paidOn: IsoDate | null
  /** Take-home pay on one paycheck, as the newest paystub shows it; null when not shown. */
  takeHomeCents: number | null
  /** True while that take-home stands for a paycheck the bank shows, in pay and safe to spend. */
  appliedToPay: boolean
  /** Yearly gross, taxes withheld and retirement, while the state is used; otherwise null. */
  figures: PaystubFigures | null
}

/** A saved paystub's state: see PaystubUseState. */
function stateOf(fresh: boolean, figures: PaystubFigures | null): PaystubUseState {
  if (!fresh) return 'stale'
  return figures ? 'used' : 'partial'
}

/** Where the newest paystub stands, and what of it Leeway uses: see the note at the top. */
export function paystubUse(
  latest: SavedPaystub | null,
  profile: Pick<FinancialProfile, 'paystub' | 'pay'>,
  today: IsoDate,
): PaystubUse {
  if (!latest) {
    return { state: 'none', paidOn: null, takeHomeCents: null, appliedToPay: false, figures: null }
  }
  const fresh = freshPaystub(latest, today) !== null
  // The profile's figures come only from a recent paystub confirmed in full.
  const figures = fresh ? profile.paystub : null
  return {
    state: stateOf(fresh, figures),
    paidOn: paystubDate(latest),
    takeHomeCents: latest.current.netPay,
    appliedToPay: fresh && profile.pay.employers.some((employer) => employer.fromPaystub === true),
    figures,
  }
}
