// Net worth: the figure first, with what is owned and owed under it, then
// "Is your net worth growing?" over a range, against where it started. A
// tapped day reads out what was owned and owed that day.

import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAction } from '../../api/hooks'
import { LineChart } from '../../components/charts/LineChart'
import { Card } from '../../components/design/Card'
import { HeroFigure } from '../../components/design/HeroFigure'
import { Money } from '../../components/design/Money'
import { WorthChangeLine } from '../../components/WorthChange'
import { LoadingOrError, Segmented } from '../../components/ui'
import { useApp } from '../../lib/app'
import { netWorthDrill } from '../../lib/drills/plan'
import { shortDate } from '../../lib/format'
import { startReference, worthChange } from '../../lib/worth'
import { settingsPath } from '../settings/paths'

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
  const change = worthChange(worth.data)

  return (
    <>
      <Card drill={netWorthDrill(worth.data)} label="Net worth" className="hero stack-sm">
        <HeroFigure
          label="Net worth"
          cents={netWorthCents}
          tone={netWorthCents < 0 ? 'problem' : undefined}
          caption={
            <>
              <Money cents={assetsCents} /> owned, less <Money cents={liabilitiesCents} /> owed
            </>
          }
        />
      </Card>
      <Card static="chart" label="Net worth over time" className="stack">
        <div className="row-between wrap">
          <h2>Is your net worth growing?</h2>
          <Segmented label="Range" value={range} options={RANGES} onChange={setRange} />
        </div>
        {change ? (
          <>
            <WorthChangeLine change={change} />
            <LineChart
              points={points}
              label="Net worth over time"
              reference={startReference(change)}
              details={(index) => [
                <>
                  <Money cents={history[index]!.assetsCents} /> owned
                </>,
                <>
                  <Money cents={history[index]!.liabilitiesCents} /> owed
                </>,
              ]}
              description={`Net worth from ${money(change.fromCents)} on ${shortDate(change.fromDate, settings.locale)} to ${money(netWorthCents)} today.`}
            />
          </>
        ) : (
          <p className="empty">History builds as balances change. Check back after a few syncs.</p>
        )}
        <p className="small muted">
          Add a house, car or other account by hand in{' '}
          <Link to={settingsPath('accounts')}>Settings, then Accounts</Link> to count it here.
        </p>
      </Card>
    </>
  )
}
