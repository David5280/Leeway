// Coming up: the next six weeks with a calendar linked, week by week, with
// paydays, bills due and the events likely to cost money, each with what to
// set aside where past ones show it. A bill opens its own form; an event
// opens a purchase goal to save for it. Weeks with nothing in them fold into
// one quiet line. Shown in Plan only while a calendar is linked.

import { Link } from 'react-router-dom'
import type { Forecast, ForecastItem } from '../../api/client'
import { useAction } from '../../api/hooks'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { relativeDay, shortDate } from '../../lib/format'
import {
  billPath,
  dayRange,
  EVENT_KIND_NAMES,
  quietWeeksText,
  saveForPath,
  weekLabel,
} from '../../lib/calendar'

type Week = Forecast['weeks'][number]
type Event = Extract<ForecastItem, { type: 'event' }>
type Bill = Extract<ForecastItem, { type: 'bill' }>

/** Where the amount to set aside comes from ("From 2 past trips"), or why there is none. */
function setAsideText(event: Event): string {
  if (event.suggestedCents === null) return 'No past ones to go by yet'
  const kind = EVENT_KIND_NAMES[event.kind].toLowerCase()
  return `From ${event.basedOn} past ${kind}s`
}

/** A row's name and what to say under it. */
function RowText({ name, detail, tone }: { name: string; detail: string; tone?: string }) {
  return (
    <span className="grow stack-sm" style={{ gap: 0, minWidth: 0 }}>
      <span className="ellipsis" style={{ fontWeight: 500 }}>
        {name}
      </span>
      <span className={`small ${tone ?? 'muted'}`}>{detail}</span>
    </span>
  )
}

function EventRow({ event, today }: { event: Event; today: string }) {
  const { settings } = useApp()
  const when =
    event.date === event.endsOn
      ? relativeDay(event.date, today, settings.locale)
      : dayRange({ startsOn: event.date, endsOn: event.endsOn }, settings.locale)
  return (
    <Link to={saveForPath(event)} className="list-row clickrow">
      <RowText
        name={event.title}
        detail={`${EVENT_KIND_NAMES[event.kind]}, ${when}. ${setAsideText(event)}`}
      />
      {event.suggestedCents !== null && (
        <span className="stack-sm" style={{ gap: 0, textAlign: 'right' }}>
          <Money cents={event.suggestedCents} />
          <span className="small muted">set aside</span>
        </span>
      )}
    </Link>
  )
}

function BillRow({ bill, today }: { bill: Bill; today: string }) {
  const { settings } = useApp()
  const detail = bill.overdue
    ? `Overdue since ${shortDate(bill.date, settings.locale)}`
    : `Due ${relativeDay(bill.date, today, settings.locale)}`
  return (
    <Link to={billPath(bill.billId)} className="list-row clickrow">
      <RowText name={bill.name} detail={detail} tone={bill.overdue ? 'over' : undefined} />
      <Money cents={bill.amountCents} sign="transaction" />
    </Link>
  )
}

function ItemRow({ item, today }: { item: ForecastItem; today: string }) {
  const { settings } = useApp()
  if (item.type === 'event') return <EventRow event={item} today={today} />
  if (item.type === 'bill') return <BillRow bill={item} today={today} />
  return (
    <div className="list-row">
      <RowText name="Payday" detail={relativeDay(item.date, today, settings.locale)} />
      {item.amountCents !== null && <Money cents={-item.amountCents} sign="transaction" />}
    </div>
  )
}

/**
 * A key unique within a week: one payday a day, a bill once per due day, and
 * one event per kind and first day, since the server merges events of one
 * kind that overlap.
 */
function itemKey(item: ForecastItem): string {
  if (item.type === 'payday') return `payday ${item.date}`
  if (item.type === 'bill') return `bill ${item.billId} ${item.date}`
  return `event ${item.kind} ${item.date}`
}

function WeekCard({ week, index, today }: { week: Week; index: number; today: string }) {
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
      {week.items.map((item) => (
        <ItemRow key={itemKey(item)} item={item} today={today} />
      ))}
    </Card>
  )
}

/** One or more weeks in a row with nothing in them, as a single quiet line. */
function QuietWeeks({ first, weeks }: { first: number; weeks: Week[] }) {
  const { settings } = useApp()
  const text = quietWeeksText(first, weeks[0]!.start, weeks.at(-1)!.end, settings.locale)
  return (
    <Card static="empty" label={text}>
      <p className="empty">{text}.</p>
    </Card>
  )
}

/** The weeks, with each run of empty ones gathered: [index of its first week, its weeks]. */
function runsOf(weeks: Week[]): [number, Week[]][] {
  const runs: [number, Week[]][] = []
  weeks.forEach((week, index) => {
    const last = runs.at(-1)
    const quiet = week.items.length === 0
    if (quiet && last && last[1].at(-1)!.items.length === 0) last[1].push(week)
    else runs.push([index, [week]])
  })
  return runs
}

export function AheadSection() {
  const forecast = useAction('get_forecast')
  if (!forecast.data) return <LoadingOrError error={forecast.error} />
  const { today, weeks } = forecast.data
  return (
    <>
      {runsOf(weeks).map(([first, run]) =>
        run[0]!.items.length === 0 ? (
          <QuietWeeks key={run[0]!.start} first={first} weeks={run} />
        ) : (
          <WeekCard key={run[0]!.start} week={run[0]!} index={first} today={today} />
        ),
      )}
    </>
  )
}
