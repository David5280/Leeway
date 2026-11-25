// Top merchants, a tap deeper from Spending's Trends row: where the most went
// in the period Spending was showing (?period=), and the way back to it.

import { useAction } from '../api/hooks'
import { BackLink } from '../components/BackLink'
import { Shell } from '../components/Shell'
import { useApp } from '../lib/app'
import { periodLabel, periodWord } from '../lib/format'
import { paths } from '../routes'
import { periodDistance, useSpendingPeriod } from './spending/period'
import { MerchantsList } from './spending/trends/MerchantsList'

export function TopMerchantsPage() {
  const [period] = useSpendingPeriod()
  const { settings } = useApp()
  // The same read Spending made, so the dates come from its cache.
  const budget = useAction('get_budget', { offset: period })
  const when = budget.data
    ? periodLabel(budget.data.period.start, budget.data.period.end, settings.locale)
    : periodDistance(period, periodWord(settings.period.kind))
  return (
    <Shell>
      <BackLink to={paths.spending(period)} label="Spending" />
      <h1>Top merchants</h1>
      <MerchantsList period={period} when={when} />
    </Shell>
  )
}
