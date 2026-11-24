// The drill-down behind income against spending: the answer (what a usual
// month keeps), the math (in less out), then each month, newest first.

import type { DrillDown } from '../drill'
import type { Flows } from '../flows'
import { paths } from '../../routes'

export function flowsDrill(flows: Flows, month: (iso: string) => string): DrillDown {
  const usual = flows.usual
  const kept = usual?.keptCents ?? 0
  const short = kept < 0
  const tone = short ? ('problem' as const) : undefined
  const count = usual?.count ?? 0
  return {
    title: 'Money in and out',
    subtitle:
      count === 0
        ? 'No finished month yet'
        : `A usual month, from the last ${count === 1 ? 'finished month' : `${count} finished months`}`,
    figure: { cents: Math.abs(kept), tone },
    math: {
      terms: [
        {
          label: 'Money in',
          value: { cents: usual?.incomeCents ?? 0, sign: 'change', tone: 'in' },
        },
        { label: 'money out', value: { cents: usual?.spentCents ?? 0 }, op: 'minus' },
      ],
      result: {
        label: short ? 'Short each month' : 'Kept each month',
        value: { cents: Math.abs(kept), tone },
      },
      note: 'Transfers between your own accounts count as neither. This month is left out until it ends.',
    },
    items: {
      title: 'Each month',
      rows: [...flows.months].reverse().map((one) => ({
        key: one.start,
        label: one.current ? `${month(one.start)}, so far` : month(one.start),
        detail: one.keptCents < 0 ? 'Short' : 'Kept',
        value: {
          cents: Math.abs(one.keptCents),
          tone: !one.current && one.keptCents < 0 ? 'problem' : undefined,
        },
      })),
    },
    more: { to: paths.activity(), label: 'Open activity' },
  }
}
