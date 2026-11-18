// Net worth: what is owned minus what is owed, and how that has moved.

import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'
import { useAction } from '../../api/hooks'
import { LineChart } from '../../components/charts/LineChart'
import { Card, LoadingOrError, Segmented } from '../../components/ui'
import { useApp } from '../../lib/app'
import { shortDate } from '../../lib/format'

const RANGES = [
  { value: '90', label: '3 months' },
  { value: '365', label: '1 year' },
  { value: '1825', label: '5 years' },
] as const

export function NetWorthSection() {
  const { money, settings } = useApp()
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('365')
  const worth = useAction(
    'get_net_worth',
    { days: Number(range) },
    { placeholderData: keepPreviousData },
  )
  if (!worth.data) return <LoadingOrError error={worth.error} />
  const { assetsCents, liabilitiesCents, netWorthCents, history } = worth.data
  const points = history.map((p) => ({ date: p.date, cents: p.netWorthCents }))

  return (
    <>
      <div className="grid">
        <Card label="Net worth" className="span-4 stack-sm">
          <span className="eyebrow">Net worth</span>
          <span className={`mid-number num ${netWorthCents < 0 ? 'over' : ''}`}>
            {money(netWorthCents)}
          </span>
        </Card>
        <Card label="Assets" className="span-4 stack-sm">
          <span className="eyebrow">You own</span>
          <span className="mid-number num">{money(assetsCents)}</span>
        </Card>
        <Card label="Debts" className="span-4 stack-sm">
          <span className="eyebrow">You owe</span>
          <span className="mid-number num">{money(liabilitiesCents)}</span>
        </Card>
      </div>
      <Card label="Net worth over time" className="stack">
        <div className="row-between wrap">
          <h2>Over time</h2>
          <Segmented label="Range" value={range} options={RANGES} onChange={setRange} />
        </div>
        {points.length < 2 ? (
          <p className="empty">History builds as balances change. Check back after a few syncs.</p>
        ) : (
          <LineChart
            points={points}
            label="Net worth over time"
            description={`Net worth from ${money(points[0]!.cents)} on ${shortDate(points[0]!.date, settings.locale)} to ${money(points.at(-1)!.cents)} on ${shortDate(points.at(-1)!.date, settings.locale)}.`}
          />
        )}
        <p className="small muted">
          Add a house, car or other account by hand under Customize to count it here.
        </p>
      </Card>
    </>
  )
}
