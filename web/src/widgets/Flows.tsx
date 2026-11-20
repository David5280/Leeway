// "Are you spending less than you earn?": money in beside money out for the
// last six months, with what a usual month keeps as the answer. The card
// opens each month and the math behind the answer (lib/drills/flows.ts).

import { useAction } from '../api/hooks'
import { FlowBars } from '../components/charts/FlowBars'
import { Card } from '../components/design/Card'
import { Money } from '../components/design/Money'
import { SectionHead } from '../components/design/SectionHead'
import { LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { flowsDrill } from '../lib/drills/flows'
import { flowsFrom, flowsHeadline } from '../lib/flows'
import { monthYear } from '../lib/format'

/** Months the Overview's chart shows: enough to see a pattern, few enough to read on a phone. */
export const FLOW_MONTHS = 6

const TITLE = 'Are you spending less than you earn?'

export function FlowsWidget() {
  const { settings } = useApp()
  const totals = useAction('get_monthly_totals', { months: FLOW_MONTHS })
  const head = <SectionHead icon="growth" title={TITLE} />
  if (!totals.data) {
    return (
      <Card static="empty" label="Money in and out" className="stack-sm">
        {head}
        <LoadingOrError error={totals.error} />
      </Card>
    )
  }
  const flows = flowsFrom(totals.data)
  const headline = flowsHeadline(flows)
  return (
    <Card
      drill={flowsDrill(flows, (iso) => monthYear(iso, settings.locale))}
      label="Money in and out"
      className="stack-sm"
    >
      {head}
      {headline ? (
        <p className="row wrap" style={{ gap: 6, alignItems: 'baseline' }}>
          <Money
            cents={headline.cents}
            tone={flows.usual!.keptCents < 0 ? 'problem' : undefined}
            className="mid-number"
          />
          <span className="muted">{headline.words}</span>
        </p>
      ) : (
        <p className="small muted">Your first full month shows here once it ends.</p>
      )}
      <FlowBars
        months={flows.months}
        usualSpentCents={flows.usual?.spentCents ?? null}
        label="Money in and out each month"
      />
      <p className="flow-key small muted" aria-hidden="true">
        <span className="flow-swatch in" /> In
        <span className="flow-swatch out" /> Out
      </p>
    </Card>
  )
}
