// The newest confirmed paystub, applied across Leeway: what it says of pay
// (pay/paystubPay.ts), and the figures the financial profile and the
// savings rate read. Every figure comes from derived.ts, so the review
// screen, the profile and an assistant read the same numbers.
//
// Staleness: a paystub speaks only while it is the newest one saved and
// recent (freshPaystub, about six months). A newer paystub saved without
// its lines, or an old one, gives nothing here, so it never overrides better
// data. Year-to-date withholding carries the year it runs through, so last
// December's totals are never read as this year's. A line the paystub does
// not show stays null, never 0.

import type { Db } from '../../db/pool.js'
import { dateParts, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { freshPaystub, paystubDate, paystubPlan } from '../savings/payrollMonths.js'
import {
  effectiveTaxRate,
  employerMatchShare,
  oneOffCents,
  retirementSavingsRate,
  yearlyGross,
  type SavingsRate,
  type Share,
  type YearlyGross,
} from './derived.js'
import { detailOf, type SavedDetail } from './detailStore.js'
import { latestPaystub } from './paystubs.js'

/** What the newest confirmed paystub says of a usual paycheck, for pay/paystubPay.ts. */
export interface PaystubPay {
  payDate: IsoDate
  cadence: Cadence
  /** Take-home pay of one usual paycheck. */
  netCents: number
  /** Who paid, only to tell which job it is from; never shown or returned. */
  employerName: string | null
}

/** Taxes withheld, as the paystub shows them. */
export interface PaystubTaxes {
  /** The year its year-to-date totals run through. */
  year: number
  /** Federal income tax withheld that year through the paystub; null when not shown. */
  federalWithheldCents: number | null
  /** State income tax withheld that year through the paystub; null when not shown. */
  stateWithheldCents: number | null
  /** Every tax withheld as a share of gross: withholding, not what is finally owed. */
  effectiveRate: Share | null
}

/** What the newest confirmed paystub gives the financial profile. Totals only: no names or numbers. */
export interface PaystubFigures {
  /** The day it was paid, or saved when it shows no pay date. */
  paidOn: IsoDate
  yearlyGross: YearlyGross | null
  taxes: PaystubTaxes
  /** What the employee and the employer put toward retirement, as a share of gross. */
  retirement: SavingsRate | null
  /** The employer's match a month, or null when the paystub shows none. */
  matchMonthlyCents: number | null
}

/** What the newest paystub gives the savings rate, and the profile's paystub figures. */
export interface PaystubPayroll {
  /** The 401(k), 457 or 403(b) a month (savings/payrollMonths.ts), or null. */
  planMonthlyCents: number | null
  /** The plan an old paystub shows but that is left out, by name, or null. */
  stalePlan: string | null
  matchMonthlyCents: number | null
  figures: PaystubFigures | null
}

/**
 * A usual paycheck's take-home pay, or null when the paystub cannot say
 * one: no pay date or cadence to place it, no net pay, or a bonus or
 * commission in it, which would read as every paycheck's.
 */
export function paystubPayOf(detail: SavedDetail): PaystubPay | null {
  const { payDate, payCadence, employerName } = detail
  const net = detail.pay.net.current
  if (payDate === null || payCadence === null || net === null || net <= 0) return null
  if (oneOffCents(detail) > 0) return null
  return { payDate, cadence: payCadence, netCents: net, employerName }
}

/**
 * The match a month: its share of gross times a month of yearly gross, so
 * a share read from the year so far and one read from this paycheck both
 * come out as a usual month.
 */
function matchMonthly(share: Share | null, gross: YearlyGross | null): number | null {
  if (share === null || gross === null || share.rate <= 0) return null
  return Math.round((share.rate * gross.cents) / 12)
}

/** The figures a confirmed paystub gives the profile, worked out by derived.ts. */
export function paystubFigures(detail: SavedDetail): PaystubFigures {
  const paidOn = paystubDate(detail)
  const gross = yearlyGross(detail, detail.payDate)
  return {
    paidOn,
    yearlyGross: gross,
    taxes: {
      year: dateParts(paidOn).year,
      federalWithheldCents: detail.taxes.federalIncome.yearToDate,
      stateWithheldCents: detail.taxes.stateIncome.yearToDate,
      effectiveRate: effectiveTaxRate(detail),
    },
    retirement: retirementSavingsRate(detail),
    matchMonthlyCents: matchMonthly(employerMatchShare(detail), gross),
  }
}

/** The newest paystub's lines while it is recent, or null: see the note at the top. */
export async function readLatestDetail(db: Db, today: IsoDate): Promise<SavedDetail | null> {
  const fresh = freshPaystub(await latestPaystub(db), today)
  return fresh ? detailOf(db, fresh.id) : null
}

/** What the newest paystub gives the savings rate and the profile, read once for both. */
export async function readPaystubPayroll(db: Db, today: IsoDate): Promise<PaystubPayroll> {
  const paystub = await latestPaystub(db)
  const plan = paystubPlan(paystub, today)
  const fresh = freshPaystub(paystub, today)
  const detail = fresh ? await detailOf(db, fresh.id) : null
  const figures = detail ? paystubFigures(detail) : null
  return {
    planMonthlyCents: plan.monthlyCents,
    stalePlan: plan.stale,
    matchMonthlyCents: figures?.matchMonthlyCents ?? null,
    figures,
  }
}
