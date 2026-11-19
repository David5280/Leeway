// Net worth: what is owned minus what is owed, and how that has moved.

import { Card } from '../../components/design/Card'
import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction } from '../../api/hooks'
import { LineChart } from '../../components/charts/LineChart'
import { LoadingOrError, Segmented } from '../../components/ui'
import { useApp } from '../../lib/app'
import { shortDate } from '../../lib/format'
import { settingsPath } from '../settings/paths'
import { Money } from '../../components/design/Money'

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
        <Card static="pending" label="Net worth" className="span-4 stack-sm">
          <span className="eyebrow">Net worth</span>
          <Money
            cents={netWorthCents}
            tone={netWorthCents < 0 ? 'problem' : undefined}
            className="mid-number"
          />
        </Card>
        <Card static="pending" label="Assets" className="span-4 stack-sm">
          <span className="eyebrow">You own</span>
          <Money cents={assetsCents} className="mid-number" />
        </Card>
        <Card static="pending" label="Debts" className="span-4 stack-sm">
          <span className="eyebrow">You owe</span>
          <Money cents={liabilitiesCents} className="mid-number" />
        </Card>
      </div>
      <Card static="chart" label="Net worth over time" className="stack">
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
          Add a house, car or other account by hand in{' '}
          <Link to={settingsPath('accounts')}>Settings, then Accounts</Link> to count it here.
        </p>
      </Card>
    </>
  )
}
