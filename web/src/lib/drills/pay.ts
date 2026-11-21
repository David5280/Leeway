// The drill-down for the owner's pay: one paycheck, how it adds up to a
// month, and each employer paying now. Pure, like every drill in lib/drills.

import type { PayView } from '../../api/client'
import { PAY_CADENCE_WORDS, sourceNote } from '../../pages/plan/payday/payText'
import type { DrillDown, DrillItem, MathTerm } from '../drill'

type PayInUse = NonNullable<PayView['pay']>

/**
 * Paychecks a year, to one decimal: every 2 weeks is 26.1 (365.25 days over
 * 14), which is how the server spreads a paycheck over a month.
 */
function perYear(pay: PayInUse): string {
  return String(Math.round((pay.monthlyCents * 120) / pay.paycheckCents) / 10)
}

/** A month of pay: each employer's share, or the one paycheck's when there is only one. */
function monthTerms(view: PayView, pay: PayInUse): MathTerm[] {
  const employers = view.found?.employers ?? []
  // Pay the owner entered stands alone; so does a single job.
  if (pay.source === 'yours' || employers.length < 2) {
    return [
      { label: 'One paycheck', value: { cents: pay.paycheckCents } },
      {
        label: 'paychecks a year, over 12 months',
        value: { text: perYear(pay) },
        op: 'and',
      },
    ]
  }
  return employers.map((employer, index) => ({
    label: `${employer.name}, a month`,
    value: { cents: employer.monthlyCents },
    ...(index > 0 && { op: 'plus' as const }),
  }))
}

function employerRows(view: PayView, date: (iso: string) => string): DrillItem[] {
  return (view.found?.employers ?? []).map((employer) => ({
    key: employer.name,
    label: employer.name,
    detail: `Paid ${PAY_CADENCE_WORDS[employer.cadence]}, next ${date(employer.nextPayday)}`,
    value: { cents: employer.paycheckCents },
  }))
}

/** Pay in use: the paycheck, and what it comes to in a month. */
export function payDrill(view: PayView, pay: PayInUse, date: (iso: string) => string): DrillDown {
  const rows = pay.source === 'yours' ? [] : employerRows(view, date)
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
