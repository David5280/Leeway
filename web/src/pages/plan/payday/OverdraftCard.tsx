// "Will checking last until payday?": each checking account walked forward
// to payday (overdraft/ on the server). An account that would go below zero
// gets its own amber card saying when, by how much, and which account could
// cover it; red only when it is below zero already. When every account
// lasts, one quiet card says so. Leeway never moves the money itself.

import type { AccountForecast, OverdraftForecast } from '../../../api/client'
import { useAction } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { KeyFigure } from '../../../components/design/KeyFigure'
import { Money } from '../../../components/design/Money'
import { SectionHead } from '../../../components/design/SectionHead'
import { LoadingOrError } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { forecastDrill } from '../../../lib/drills/overdraft'
import { dayLabel } from '../../../lib/format'

/** One account heading below zero: when, by how much, and the move that would cover it. */
function ShortCard({ forecast, payday }: { forecast: AccountForecast; payday: string }) {
  const { money, settings } = useApp()
  const date = (iso: string) => dayLabel(iso, settings.locale)
  const now = forecast.overdrawnNow
  const { move } = forecast
  return (
    <Card
      drill={forecastDrill(forecast, payday, date, money)}
      label={`${forecast.accountName} before payday`}
      className={`stack-sm ${now ? 'over-card' : 'warn-card'}`}
    >
      <SectionHead
        icon="warn"
        title={
          now ? `${forecast.accountName} is below zero` : `${forecast.accountName} may run short`
        }
      />
      <KeyFigure
        label={now ? 'Short by, at its lowest' : 'Could go below zero by'}
        cents={forecast.shortCents}
        tone={now ? 'problem' : 'warn'}
        caption={
          now ? (
            <>Before payday, {date(payday)}.</>
          ) : (
            <>
              On <b>{date(forecast.belowZeroOn!)}</b>, before payday.
            </>
          )
        }
      />
      <p className="small">
        {move ? (
          <>
            Moving <Money cents={move.amountCents} /> from <b>{move.fromAccountName}</b> by{' '}
            {date(move.byDate)} would cover it.
          </>
        ) : (
          'No other account has enough to spare right now.'
        )}
      </p>
    </Card>
  )
}

/** Every account lasts: one line, opening the closest call. */
function LastsCard({ forecast }: { forecast: OverdraftForecast }) {
  const { money, settings } = useApp()
  const date = (iso: string) => dayLabel(iso, settings.locale)
  const closest = [...forecast.accounts].sort((a, b) => a.lowestCents - b.lowestCents)[0]!
  const every = forecast.accounts.length > 1 ? 'Every checking account stays' : 'Checking stays'
  return (
    <Card
      drill={forecastDrill(closest, forecast.payday, date, money)}
      label="Checking until payday"
      className="stack-sm"
    >
      <SectionHead icon="check" title="Checking until payday" />
      <p>
        {every} above zero until payday, {date(forecast.payday)}. At its lowest,{' '}
        <Money cents={closest.lowestCents} /> on {date(closest.lowestDate)}.
      </p>
    </Card>
  )
}

/**
 * The forecast in its place on Payday: accounts running short lead the
 * screen (`short`), while the all-clear sits lower down (`lasts`). Each
 * place draws only its own case, from the same cached read.
 */
export function OverdraftCard({ place }: { place: 'short' | 'lasts' }) {
  const forecast = useAction('get_overdraft_forecast')
  if (!forecast.data) {
    return place === 'short' ? (
      <LoadingOrError error={forecast.error} label="Loading the forecast" />
    ) : null
  }
  const { accounts, payday } = forecast.data
  const short = accounts.filter((account) => account.belowZeroOn !== null)
  // No checking account has nothing to say in either place.
  if (accounts.length === 0) return null
  if (place === 'lasts') return short.length === 0 ? <LastsCard forecast={forecast.data} /> : null
  return (
    <>
      {short.map((account) => (
        <ShortCard key={account.accountId} forecast={account} payday={payday} />
      ))}
    </>
  )
}
