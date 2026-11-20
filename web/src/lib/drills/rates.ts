// The drill-down behind the savings rate: the usual month as the answer, the
// newest finished month's money as the math (saved out of pay), what was
// counted, then each month, newest first. Pure.

import type { DrillDown } from '../drill'
import { reachedTarget, usualRate, type MonthRate, type SavingsRates } from '../rates'

/** The newest finished month with a rate, or the running one when none has finished. */
function shownMonth(months: MonthRate[]): MonthRate | undefined {
  const finished = months.filter((one) => !one.current && one.percent !== null)
  return finished.at(-1) ?? months.find((one) => one.current && one.percent !== null)
}

/** What the usual month is made of, in a few words. */
function subtitleFor(count: number): string {
  if (count === 0) return 'No finished month with a rate yet'
  if (count === 1) return 'A usual month: the one finished month so far'
  return `A usual month: the middle of the last ${count} finished months`
}

export function savingsRateDrill(
  rates: SavingsRates,
  month: (iso: string) => string,
  money: (cents: number) => string,
): DrillDown {
  const usual = usualRate(rates.months)
  const count = rates.months.filter((one) => !one.current && one.percent !== null).length
  const shown = shownMonth(rates.months)
  return {
    title: 'Savings rate',
    subtitle: subtitleFor(count),
    figure: { text: usual === null ? 'Not known yet' : `${usual}%` },
    math: {
      terms: shown
        ? [
            {
              label: `Saved in ${month(shown.start)}${shown.current ? ', so far' : ''}`,
              value: { cents: shown.savedCents },
            },
            { label: 'pay', value: { cents: shown.payCents }, op: 'over' },
          ]
        : [{ label: 'Saved', value: { text: 'Not seen yet' } }],
      result: {
        label: 'Share of pay saved',
        value: { text: shown ? `${shown.percent}%` : 'Not known yet' },
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
