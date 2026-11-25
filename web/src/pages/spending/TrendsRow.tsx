// The Trends row: both answer "where did it go?", each on its own page a tap
// deeper. Each carries the period Spending is showing: Top merchants opens on
// it, and both lead back to it.

import { LinkRows } from '../../components/LinkRows'
import { useApp } from '../../lib/app'
import { periodWord } from '../../lib/format'
import { paths } from '../../routes'
import { periodDistance } from './period'
import { OVER_TIME_PERIODS } from './trends/OverTime'

export function TrendsRow({ period }: { period: number }) {
  const { settings } = useApp()
  const word = periodWord(settings.period.kind)
  return (
    <LinkRows
      label="Trends"
      rows={[
        {
          to: paths.spendingOverTime(period),
          label: 'Spending over time',
          icon: 'growth',
          detail: `Each of the last ${OVER_TIME_PERIODS} ${word}s`,
        },
        {
          to: paths.topMerchants(period),
          label: 'Top merchants',
          icon: 'moneyOut',
          detail: `Where the most went, ${periodDistance(period, word).toLowerCase()}`,
        },
      ]}
    />
  )
}
