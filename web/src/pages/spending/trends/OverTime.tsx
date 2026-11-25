// Spending over time: what went out in each of the last twelve budget periods
// as bars against today's budgets, then each period as a row, newest first,
// that opens Spending on that period.

import { Link } from 'react-router-dom'
import { useAction } from '../../../api/hooks'
import { SpendingBars, type Trends } from '../../../components/charts/SpendingBars'
import { Card } from '../../../components/design/Card'
import { Money } from '../../../components/design/Money'
import { SectionHead } from '../../../components/design/SectionHead'
import { Icon, LoadingOrError } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { periodLabel, periodWord } from '../../../lib/format'
import { paths } from '../../../routes'
import { periodDistance } from '../period'

/** How many budget periods the page reaches back, the current one included. */
export const OVER_TIME_PERIODS = 12

export function OverTime() {
  const trends = useAction('get_trends', { periods: OVER_TIME_PERIODS })
  const budget = useAction('get_budget', { offset: 0 })
  const { settings } = useApp()
  if (!trends.data) {
    return <LoadingOrError error={trends.error} label="Loading spending over time" />
  }
  return (
    <>
      <Card static="chart" label="Spending by period" className="stack-sm">
        <SectionHead icon="growth" title={`Each ${periodWord(settings.period.kind)}`} />
        {/* The line is today's budgets; until they load the bars stand alone. */}
        <SpendingBars
          trends={trends.data}
          budgetCents={budget.data?.totals.budgetedCents || null}
        />
      </Card>
      <PeriodRows trends={trends.data} />
    </>
  )
}

/** Each period, newest first, opening Spending on it. */
function PeriodRows({ trends }: { trends: Trends }) {
  const { settings } = useApp()
  const word = periodWord(settings.period.kind)
  const newestFirst = [...trends].reverse()
  return (
    <Card static="list" label="Periods" className="tight stack-sm">
      {newestFirst.map((period) => (
        <Link
          key={period.start}
          to={paths.spending(period.offset)}
          className="list-row clickrow link-row"
        >
          <span className="grow stack-sm link-row-words">
            <span className="link-row-label">
              {periodLabel(period.start, period.end, settings.locale)}
            </span>
            <span className="small muted">{periodDistance(period.offset, word)}</span>
          </span>
          <Money cents={period.spentCents} />
          <Icon name="forward" size={18} />
        </Link>
      ))}
    </Card>
  )
}
