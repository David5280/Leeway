// The drill-down for spare cash in checking that could sit in savings. Pure.

import type { Output } from '../../api/client'
import type { DrillDown } from '../drill'

type IdleCash = Output<'get_idle_cash'>

/**
 * Spare cash: what checking holds, less the bills, typical spending and the
 * cushion before payday, and what the rest could earn at the assumed rate.
 */
export function idleCashDrill(idle: IdleCash, date: (iso: string) => string): DrillDown {
  return {
    title: 'Spare cash in checking',
    subtitle: `Until payday, ${date(idle.nextPayday)}`,
    figure: { cents: idle.idleCents },
    math: {
      terms: [
        { label: 'In checking', value: { cents: idle.checkingCents } },
        { label: 'bills due before payday', value: { cents: idle.billsCents }, op: 'minus' },
        {
          label: 'typical spending until payday',
          value: { cents: idle.spendingCents },
          op: 'minus',
        },
        { label: 'a cushion kept for surprises', value: { cents: idle.cushionCents }, op: 'minus' },
      ],
      result: { label: 'Could sit in savings', value: { cents: idle.idleCents } },
      note: `Rounded down. In savings at an assumed ${idle.apyPercent}% APY, it would earn about this much a year: rates vary by bank. Leeway never moves money; move it yourself if you like.`,
    },
    items: {
      title: `What it could earn at ${idle.apyPercent}% APY`,
      rows: [
        {
          key: 'year',
          label: 'In a year',
          value: { cents: idle.yearlyInterestCents, tone: 'in' },
        },
        {
          key: 'month',
          label: 'In a month, about',
          value: { cents: Math.round(idle.yearlyInterestCents / 12), tone: 'in' },
        },
      ],
    },
  }
}
