// The drill-down for cash in checking that could earn more in savings. Pure.

import type { Output } from '../../api/client'
import type { DrillDown, MathTerm } from '../drill'

type IdleCash = Output<'get_idle_cash'>

/** The card's and the drill's one name, so the two always agree. */
export const IDLE_CASH_TITLE = 'Cash that could earn more'

/** A term taken away, left out when it is $0 so the math stays short. */
function minus(label: string, cents: number): MathTerm[] {
  return cents > 0 ? [{ label, value: { cents }, op: 'minus' }] : []
}

/**
 * What checking holds, less the bills, typical spending, what the cards owe,
 * the cushion and the rounding before payday: the terms add up to exactly
 * the figure shown, and what the rest could earn at the assumed rate.
 */
export function idleCashDrill(idle: IdleCash, date: (iso: string) => string): DrillDown {
  return {
    title: IDLE_CASH_TITLE,
    subtitle: `Until payday, ${date(idle.nextPayday)}`,
    figure: { cents: idle.idleCents },
    math: {
      terms: [
        { label: 'In checking', value: { cents: idle.checkingCents } },
        // Always shown, even at $0, since "no bills" is worth seeing.
        { label: 'bills due by payday', value: { cents: idle.billsCents }, op: 'minus' },
        {
          label: 'typical spending until payday',
          value: { cents: idle.spendingCents },
          op: 'minus',
        },
        ...minus('credit cards owed', idle.cardsOwedCents),
        { label: 'a cushion kept for surprises', value: { cents: idle.cushionCents }, op: 'minus' },
        ...minus('rounded down', idle.roundedOffCents),
      ],
      result: { label: 'Could sit in savings', value: { cents: idle.idleCents } },
      note: `Checking counts the lower of each account's balance and available balance, so an overdraft line is never counted as cash. What the cards owe stays in checking, since checking pays them. Typical spending leaves bill payments out, as the bills are counted on their own. In savings at an assumed ${idle.apyPercent}% APY, it would earn about this much a year: rates vary by bank. Leeway never moves money; move it yourself if you like.`,
    },
    items: {
      title: `What it could earn at an assumed ${idle.apyPercent}% APY`,
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
