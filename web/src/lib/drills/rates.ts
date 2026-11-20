// The drill-down behind the savings rate: the usual month as the answer, the
// finished months' rates as the math (lowest to highest, the middle one
// picked), what was counted, then each month, newest first. Pure.

import type { DrillDown, MathTerm } from '../drill'
import { reachedTarget, usualRate, type MonthRate, type SavingsRates } from '../rates'

/** What the usual month is made of, in a few words. */
function subtitleFor(count: number): string {
  if (count === 0) return 'No finished month with a rate yet'
  if (count === 1) return 'A usual month: the one finished month so far'
  return `A usual month: the middle of the last ${count} finished months`
}

/**
 * The finished months' rates, lowest first, so the usual month sits in the
 * middle of the list. An odd count has one middle month; an even count has
 * two, and the usual month is halfway between them.
 */
function middleTerms(finished: MonthRate[], month: (iso: string) => string): MathTerm[] {
  // Equal rates keep their calendar order, so the list reads the same each time.
  const sorted = [...finished].sort((a, b) => a.percent! - b.percent!)
  const middle = Math.floor(sorted.length / 2)
  const middles = sorted.length % 2 ? [middle] : [middle - 1, middle]
  return sorted.map((one, index) => ({
    label: middles.includes(index) ? `${month(one.start)}, the middle` : month(one.start),
    value: { text: `${one.percent}%` },
    ...(index > 0 && { op: 'and' as const }),
  }))
}

export function savingsRateDrill(
  rates: SavingsRates,
  month: (iso: string) => string,
  money: (cents: number) => string,
): DrillDown {
  const usual = usualRate(rates.months)
  const finished = rates.months.filter((one) => !one.current && one.percent !== null)
  const twoMiddles = finished.length > 0 && finished.length % 2 === 0
  return {
    title: 'Savings rate',
    subtitle: subtitleFor(finished.length),
    figure: { text: usual === null ? 'Not known yet' : `${usual}%` },
    math: {
      terms:
        finished.length > 0
          ? middleTerms(finished, month)
          : [{ label: 'Finished months', value: { text: 'None yet' } }],
      result: {
        label: twoMiddles ? 'Usual month, halfway between the two' : 'Usual month',
        value: { text: usual === null ? 'Not known yet' : `${usual}%` },
      },
      note: `${rates.note} The usual month is the middle one, so one big month does not set it.`,
    },
    items: {
      title: 'Each month',
      rows: [...rates.months].reverse().map((one) => ({
        key: one.start,
        label: one.current ? `${month(one.start)}, so far` : month(one.start),
        detail:
          one.percent === null
            ? 'No pay or saving seen'
            : `${money(one.savedCents)} of ${money(one.payCents)}`,
        value: {
          text: one.percent === null ? 'Not known' : `${one.percent}%`,
          tone: reachedTarget(one, rates.targetPercent) ? ('in' as const) : undefined,
        },
      })),
    },
    more: { to: '/plan/retirement', label: 'Add money taken from pay' },
  }
}
