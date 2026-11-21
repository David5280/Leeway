// Coming up: the next six weeks with a calendar linked, week by week, with
// paydays, bills due and the events likely to cost money, each with what to
// set aside where past ones show it. Shown in Plan only while a calendar is
// linked.

import type { Forecast, ForecastItem } from '../../api/client'
import { useAction } from '../../api/hooks'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { relativeDay } from '../../lib/format'
import { dayRange, EVENT_KIND_NAMES, weekLabel } from '../../lib/calendar'

type Event = Extract<ForecastItem, { type: 'event' }>

/** "Set aside about $1,250, from 2 past trips", or why there is no amount. */
function setAsideText(event: Event): string {
  if (event.suggestedCents === null) return 'No past ones to go by yet'
  const kind = EVENT_KIND_NAMES[event.kind].toLowerCase()
  return `From ${event.basedOn} past ${kind}s`
}

function EventRow({ event, today }: { event: Event; today: string }) {
  const { settings } = useApp()
  return (
    <div className="list-row">
      <span className="grow stack-sm" style={{ gap: 0, minWidth: 0 }}>
        <span className="ellipsis" style={{ fontWeight: 500 }}>
          {event.title}
        </span>
        <span className="small muted">
          {EVENT_KIND_NAMES[event.kind]},{' '}
          {event.date === event.endsOn
            ? relativeDay(event.date, today, settings.locale)
            : dayRange({ startsOn: event.date, endsOn: event.endsOn }, settings.locale)}
          . {setAsideText(event)}
        </span>
      </span>
      {event.suggestedCents !== null && (
        <span className="stack-sm" style={{ gap: 0, textAlign: 'right' }}>
          <Money cents={event.suggestedCents} />
          <span className="small muted">set aside</span>
        </span>
      )}
    </div>
  )
}

function ItemRow({ item, today }: { item: ForecastItem; today: string }) {
  const { settings } = useApp()
  if (item.type === 'event') return <EventRow event={item} today={today} />
  const when = relativeDay(item.date, today, settings.locale)
  return (
    <div className="list-row">
      <span className="grow stack-sm" style={{ gap: 0, minWidth: 0 }}>
        <span className="ellipsis" style={{ fontWeight: 500 }}>
          {item.type === 'payday' ? 'Payday' : item.name}
        </span>
        <span className="small muted">{item.type === 'payday' ? when : `Due ${when}`}</span>
      </span>
      {item.amountCents !== null && (
        <Money
          cents={item.type === 'payday' ? -item.amountCents : item.amountCents}
          sign="transaction"
        />
      )}
    </div>
  )
}

function Week({
  week,
  index,
  today,
}: {
  week: Forecast['weeks'][number]
  index: number
  today: string
}) {
  const { settings } = useApp()
  const label = weekLabel(index, week.start, settings.locale)
  return (
    <Card static="list" label={label} className="stack-sm">
      <div className="row-between wrap">
        <h2>{label}</h2>
        {(week.billsCents > 0 || week.setAsideCents > 0) && (
          <span className="small muted">
            {week.billsCents > 0 && (
              <>
                <Money cents={week.billsCents} /> in bills
              </>
            )}
            {week.billsCents > 0 && week.setAsideCents > 0 && ', '}
            {week.setAsideCents > 0 && (
              <>
                <Money cents={week.setAsideCents} /> to set aside
              </>
            )}
          </span>
        )}
      </div>
      {week.items.length === 0 && <p className="empty">Nothing due.</p>}
      {week.items.map((item) => (
        <ItemRow key={`${item.type} ${item.date} ${itemName(item)}`} item={item} today={today} />
      ))}
    </Card>
  )
}

function itemName(item: ForecastItem): string {
  if (item.type === 'payday') return ''
  return item.type === 'bill' ? item.billId : item.title
}

export function AheadSection() {
  const forecast = useAction('get_forecast')
  if (!forecast.data) return <LoadingOrError error={forecast.error} />
  const { today, weeks } = forecast.data
  return (
    <>
      {weeks.map((week, index) => (
        <Week key={week.start} week={week} index={index} today={today} />
      ))}
    </>
  )
}
