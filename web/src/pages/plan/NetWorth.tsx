// Net worth, Wealth's lead: the figure first, with what is owned and owed
// under it, which opens its drill-down; then "Is your net worth growing?"
// over a range, against where it started, a chart whose tapped day reads out
// what was owned and owed that day.

import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'
import { useAction } from '../../api/hooks'
import { LineChart } from '../../components/charts/LineChart'
import { Card } from '../../components/design/Card'
import { HeroFigure } from '../../components/design/HeroFigure'
import { Money } from '../../components/design/Money'
import { WorthChangeLine } from '../../components/WorthChange'
import { LoadingOrError, Segmented } from '../../components/ui'
import { useApp } from '../../lib/app'
import { netWorthDrill } from '../../lib/drills/plan'
import { longDate, shortDate } from '../../lib/format'
import { isoDaysAgo } from '../../lib/dates'
import { historyNote, rangesWithMore, startReference, worthChange } from '../../lib/worth'

const RANGES = [
  { value: '90', label: '3 months' },
  { value: '365', label: '1 year' },
  { value: '1825', label: '5 years' },
] as const

type Range = (typeof RANGES)[number]['value']

export function NetWorthSection() {
  const { money, settings } = useApp()
  const [picked, setRange] = useState<Range>('365')
  const startOf = (days: number) => isoDaysAgo(days, settings.timeZone)
  // History reaches the same day whatever range asks, so the last answer says which ranges show more.
  const [historyStart, setHistoryStart] = useState<string | null>(null)
  const more = rangesWithMore(
    RANGES.map((one) => Number(one.value)),
    historyStart,
    startOf,
  )
  const options = RANGES.map((one, i) => ({ ...one, disabled: historyStart !== null && !more[i] }))
  // A range with nothing more to show falls back to the longest one before it that has.
  const pickedAt = RANGES.findIndex((one) => one.value === picked)
  const range = options.slice(0, pickedAt + 1).findLast((one) => !one.disabled)!.value
  const worth = useAction(
    'get_net_worth',
    { days: Number(range) },
    { placeholderData: keepPreviousData },
  )
  // Kept from the answer as it renders, as React allows for a value from an earlier render.
  if (worth.data && worth.data.historyStart !== historyStart) {
    setHistoryStart(worth.data.historyStart)
  }
  if (!worth.data) return <LoadingOrError error={worth.error} />
  const { assetsCents, liabilitiesCents, netWorthCents, history } = worth.data
  const points = history.map((p) => ({ date: p.date, cents: p.netWorthCents }))
  const change = worthChange(worth.data)
  // With the year: history can start a year or more back.
  const note = historyNote(worth.data, startOf(Number(range)), (iso) =>
    longDate(iso, settings.locale),
  )

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
      {/* The hero above opens the math; this card is the chart, read under a finger. */}
      <Card static="chart" label="Net worth over time" className="stack">
        <h2>Is your net worth growing?</h2>
        {change && <WorthChangeLine change={change} />}
        <Segmented label="Range" value={range} options={options} onChange={setRange} />
        {change ? (
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
            description={`Net worth from ${money(change.fromCents)} on ${shortDate(change.fromDate, settings.locale)} to ${money(netWorthCents)} today.${note ? ` ${note}` : ''}`}
          />
        ) : (
          <p className="empty">History builds as balances change. Check back after a few syncs.</p>
        )}
        {change && note && <p className="small muted">{note}</p>}
      </Card>
    </>
  )
}
