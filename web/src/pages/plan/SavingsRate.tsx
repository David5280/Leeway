// "How much of your pay do you save?": the share of pay a usual month saves
// (the middle finished month), then each month against the owner's own
// target, or the usual month without one. The question and the answer open
// the month-by-month math (lib/drills/rates.ts); the bars under them keep
// their own readout under a finger. Under the bars, what was counted: bank
// transfers to savings, plus the pension and the 401(k), 457 or 403(b) Leeway
// knows, since money taken from pay never reaches the bank.

import { useAction } from '../../api/hooks'
import { RateBars } from '../../components/charts/RateBars'
import { Card } from '../../components/design/Card'
import { LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { savingsRateDrill } from '../../lib/drills/rates'
import { monthYear } from '../../lib/format'
import { fromFirstMonth, rateLevel, usualRate, type SavingsRates } from '../../lib/rates'

/** Months the chart shows: enough to see a habit, few enough to read on a phone. */
export const RATE_MONTHS = 6

const TITLE = 'How much of your pay do you save?'

export function SavingsRateCard() {
  const { money, settings } = useApp()
  const rates = useAction('get_savings_rates', { months: RATE_MONTHS })
  if (!rates.data) {
    return (
      <Card static="empty" label="Savings rate" className="stack-sm">
        <h2>{TITLE}</h2>
        <LoadingOrError error={rates.error} />
      </Card>
    )
  }
  const shown = { ...rates.data, months: fromFirstMonth(rates.data.months) }
  const usual = usualRate(shown.months)
  return (
    <Card
      drill={savingsRateDrill(shown, (iso) => monthYear(iso, settings.locale), money)}
      below={<RateChart rates={shown} />}
      label="Savings rate"
      className="stack-sm"
    >
      <h2>{TITLE}</h2>
      {usual === null ? (
        <p className="small muted">A rate shows here once a month with pay and saving ends.</p>
      ) : (
        <p className="row wrap" style={{ gap: 6, alignItems: 'baseline' }}>
          <span className="num mid-number">{usual}%</span>
          <span className="muted">of pay, in a usual month</span>
        </p>
      )}
    </Card>
  )
}

/** The bars and what they count, outside the card's button so a finger reads them. */
function RateChart({ rates }: { rates: SavingsRates }) {
  return (
    <>
      <RateBars
        months={rates.months}
        level={rateLevel(rates)}
        targetPercent={rates.targetPercent}
        label="Savings rate each month"
      />
      <p className="small muted">{rates.note}</p>
    </>
  )
}
