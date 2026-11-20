// "How much of your pay do you save?": the share of pay a usual month saves,
// then each month against the owner's own target, or the usual month without
// one. Under it, what was counted, since payroll deductions other than a
// pension the owner entered never reach the bank.

import { useAction } from '../../api/hooks'
import { RateBars } from '../../components/charts/RateBars'
import { Card } from '../../components/design/Card'
import { LoadingOrError } from '../../components/ui'
import { fromFirstMonth, rateLevel, usualRate } from '../../lib/rates'

/** Months the chart shows: enough to see a habit, few enough to read on a phone. */
export const RATE_MONTHS = 6

export function SavingsRateCard() {
  const rates = useAction('get_savings_rates', { months: RATE_MONTHS })
  const usual = rates.data ? usualRate(rates.data.months) : null
  return (
    <Card static="chart" label="Savings rate" className="stack-sm">
      <h2>How much of your pay do you save?</h2>
      {rates.data ? (
        <>
          {usual === null ? (
            <p className="small muted">A rate shows here once a month with pay and saving ends.</p>
          ) : (
            <p className="row wrap" style={{ gap: 6, alignItems: 'baseline' }}>
              <span className="num mid-number">{usual}%</span>
              <span className="muted">of pay, in a usual month</span>
            </p>
          )}
          <RateBars
            months={fromFirstMonth(rates.data.months)}
            level={rateLevel(rates.data)}
            targetPercent={rates.data.targetPercent}
            label="Savings rate each month"
          />
          <p className="small muted">{rates.data.note}</p>
        </>
      ) : (
        <LoadingOrError error={rates.error} />
      )}
    </Card>
  )
}
