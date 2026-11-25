// The next two weeks on Payday, after the cash until payday: paydays, bills
// due and, with a calendar linked, the events likely to cost money, in date
// order. They are the first two weeks of the six weeks ahead (get_forecast,
// whose weeks start today), listed with the same rows, so a bill opens its
// form and a trip opens its page on Goals. Without a calendar the paydays and
// bills still show, and the calendar goes unmentioned: linking one is a
// quiet entry in Settings and nowhere else.

import type { Forecast, ForecastItem } from '../../../api/client'
import { useAction } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { SectionHead } from '../../../components/design/SectionHead'
import { LoadingOrError } from '../../../components/ui'
import { ItemRow, itemKey } from '../Ahead'

/** How many of the forecast's weeks Payday lists. */
const WEEKS = 2

/** The items of the first two weeks, already in date order within and across weeks. */
export const nextTwoWeeks = (forecast: Forecast): ForecastItem[] =>
  forecast.weeks.slice(0, WEEKS).flatMap((week) => week.items)

export function NextTwoWeeks() {
  const forecast = useAction('get_forecast')
  return (
    <Card static="list" label="Next two weeks" className="stack-sm">
      <SectionHead icon="plan" title="Next two weeks" />
      {forecast.data ? (
        <Items forecast={forecast.data} />
      ) : (
        <LoadingOrError error={forecast.error} label="Loading the next two weeks" />
      )}
    </Card>
  )
}

function Items({ forecast }: { forecast: Forecast }) {
  const items = nextTwoWeeks(forecast)
  return (
    <>
      {items.length === 0 && <p className="empty">No paydays or bills in the next two weeks.</p>}
      {items.map((item) => (
        <ItemRow key={itemKey(item)} item={item} today={forecast.today} />
      ))}
    </>
  )
}
