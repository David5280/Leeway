// What Leeway uses from the newest paystub, for the Settings screen that
// imports one: where it stands, the figures the financial profile reads from
// it (applied.ts), whether its take-home now stands for a paycheck
// (pay/paystubPay.ts) and, when it does not, why. Pure. Totals only: never
// the employer, an account or member number, or anything else that names
// someone.

import type { IsoDate } from '../../lib/dates.js'
import type { FinancialProfile } from '../profile/profile.js'
import { freshPaystub, paystubDate } from '../savings/payrollMonths.js'
import type { PaystubFigures } from './applied.js'
import { oneOffCents } from './derived.js'
import type { SavedDetail } from './detailStore.js'
import { PLAN_FIELDS, type SavedPaystub } from './paystubs.js'

/**
 * Where the newest paystub stands:
 * - none: no paystub saved yet
 * - used: a recent paystub confirmed line by line, its figures in use
 * - stale: the newest paystub is too old to say what pay takes now
 * - partial: the newest is recent but was saved for a pension only, without
 *   every line, so at most its pension and plan figures count
 */
export type PaystubUseState = 'none' | 'used' | 'stale' | 'partial'

/**
 * Why a used paystub's take-home does not stand for a paycheck:
 * - ownPay: the owner entered their own pay, which always wins (pay/ownPay.ts)
 * - oneOff: this paycheck held a bonus or other one-off pay, so it is no usual one
 * - noSchedule: the paystub shows no pay date or how often pay comes
 * - noMatch: no job the bank shows pays near it on its schedule (pay/paystubPay.ts)
 */
export type NotForPay = 'ownPay' | 'oneOff' | 'noSchedule' | 'noMatch'

export interface PaystubUse {
  state: PaystubUseState
  /** The day the newest paystub is from: its pay date, or the day it was saved. Null with none. */
  paidOn: IsoDate | null
  /** Take-home pay on one paycheck, as the newest paystub shows it; null when not shown. */
  takeHomeCents: number | null
  /** True while that take-home stands for a paycheck the bank shows, in pay and safe to spend. */
  appliedToPay: boolean
  /** Why not, while used with a take-home that does not stand for a paycheck; otherwise null. */
  notForPay: NotForPay | null
  /** Partial only: true when its pension or a 401(k), 457 or 403(b) figure is in use. */
  retirementInUse: boolean
  /** Yearly gross, taxes withheld and retirement, while the state is used; otherwise null. */
  figures: PaystubFigures | null
}

/** What the use is read from: the newest paystub, its lines while recent, and the profile. */
export interface UseSources {
  latest: SavedPaystub | null
  /** The newest paystub's lines while it is recent and confirmed in full (applied.ts). */
  detail: SavedDetail | null
  profile: Pick<FinancialProfile, 'paystub' | 'pay'>
  /** True when the owner's own pay stands for a job (settings.pay.override, not beside jobs). */
  ownPay: boolean
}

/** A saved paystub's state: see PaystubUseState. */
function stateOf(fresh: boolean, figures: PaystubFigures | null): PaystubUseState {
  if (!fresh) return 'stale'
  return figures ? 'used' : 'partial'
}

/** Why the take-home does not stand for a paycheck, in the order pay itself decides. */
function notForPayOf(detail: SavedDetail | null, ownPay: boolean): NotForPay {
  if (ownPay) return 'ownPay'
  if (detail && oneOffCents(detail) > 0) return 'oneOff'
  if (detail && (detail.payDate === null || detail.payCadence === null)) return 'noSchedule'
  return 'noMatch'
}

/** Whether a paystub saved for a pension feeds a pension or a workplace plan. */
function feedsRetirement(paystub: SavedPaystub): boolean {
  if (paystub.pensionAccountId !== null) return true
  return PLAN_FIELDS.some((field) => (paystub.current[field] ?? 0) > 0)
}

/** Where the newest paystub stands, and what of it Leeway uses: see the note at the top. */
export function paystubUse(
  { latest, detail, profile, ownPay }: UseSources,
  today: IsoDate,
): PaystubUse {
  if (!latest) {
    return {
      state: 'none',
      paidOn: null,
      takeHomeCents: null,
      appliedToPay: false,
      notForPay: null,
      retirementInUse: false,
      figures: null,
    }
  }
  const fresh = freshPaystub(latest, today) !== null
  // The profile's figures come only from a recent paystub confirmed in full.
  const figures = fresh ? profile.paystub : null
  const state = stateOf(fresh, figures)
  const takeHomeCents = latest.current.netPay
  const appliedToPay =
    fresh && profile.pay.employers.some((employer) => employer.fromPaystub === true)
  const explained = state === 'used' && !appliedToPay && takeHomeCents !== null
  return {
    state,
    paidOn: paystubDate(latest),
    takeHomeCents,
    appliedToPay,
    notForPay: explained ? notForPayOf(detail, ownPay) : null,
    retirementInUse: state === 'partial' && feedsRetirement(latest),
    figures,
  }
}
