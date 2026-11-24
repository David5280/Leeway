// The drill-down for the owner's pay: one paycheck, how it adds up to a
// month, and each employer paying now. Pure, like every drill in lib/drills.

import type { PayView } from '../../api/client'
import { employerLabel, PAY_CADENCE_WORDS, sourceNote } from '../../pages/plan/payday/payText'
import type { DrillDown, DrillItem, MathTerm } from '../drill'

type PayInUse = NonNullable<PayView['pay']>

/**
 * Paychecks a year, to one decimal, from a month of pay and one paycheck:
 * every 2 weeks is 26.1 (365.25 days over 14), which is how the server
 * spreads a paycheck over a month.
 */
const perYear = (monthlyCents: number, paycheckCents: number) =>
  String(Math.round((monthlyCents * 120) / paycheckCents) / 10)

/** One paycheck, and how many a year make its month. */
function paycheckTerms(paycheckCents: number, monthlyCents: number): MathTerm[] {
  return [
    { label: 'One paycheck', value: { cents: paycheckCents } },
    {
      label: 'Paychecks a year, over 12 months',
      value: { text: perYear(monthlyCents, paycheckCents) },
      op: 'and',
    },
  ]
}

/**
 * The employers found, each with what to call it (named by its place among
 * them all), less the one the owner's own pay stands in for while it does.
 */
function jobsListed(view: PayView, pay: PayInUse) {
  const employers = (view.found?.employers ?? []).map((employer, rank) => ({
    ...employer,
    label: employerLabel(employer, rank),
  }))
  return pay.source === 'yours' ? employers.filter((employer) => !employer.replaced) : employers
}

/** A month of pay: each job's share, or the one paycheck's when there is only one. */
function monthTerms(view: PayView, pay: PayInUse): MathTerm[] {
  const jobs = jobsListed(view, pay).map(({ label, monthlyCents }) => ({ label, monthlyCents }))
  // The owner's own pay stands in for its job; any other job still adds its month.
  const yours = pay.source === 'yours' ? view.yours : null
  const months = yours ? [{ label: 'Your pay', monthlyCents: yours.monthlyCents }, ...jobs] : jobs
  if (months.length < 2) {
    return paycheckTerms(pay.paycheckCents, yours?.monthlyCents ?? pay.monthlyCents)
  }
  return months.map(({ label, monthlyCents }, index) => ({
    label: `${label}, a month`,
    value: { cents: monthlyCents },
    ...(index > 0 && { op: 'plus' as const }),
  }))
}

function employerRows(view: PayView, pay: PayInUse, date: (iso: string) => string): DrillItem[] {
  return jobsListed(view, pay).map((employer) => ({
    key: employer.id,
    label: employer.label,
    detail: `Paid ${PAY_CADENCE_WORDS[employer.cadence]}, next ${date(employer.nextPayday)}`,
    value: { cents: employer.paycheckCents },
  }))
}

/** Pay in use: the paycheck, and what it comes to in a month. */
export function payDrill(view: PayView, pay: PayInUse, date: (iso: string) => string): DrillDown {
  // The owner's own pay is in place of its job's, so only another job is listed.
  const rows = employerRows(view, pay, date)
  return {
    title: 'Your pay',
    subtitle: `Next payday ${date(pay.nextPayday)}`,
    figure: { cents: pay.paycheckCents, tone: 'in' },
    math: {
      terms: monthTerms(view, pay),
      result: { label: 'About a month', value: { cents: pay.monthlyCents, tone: 'in' } },
      note: sourceNote(view, pay),
    },
    items: rows.length > 0 ? { title: 'Paying now', rows } : undefined,
  }
}
