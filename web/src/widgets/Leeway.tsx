// Home's lead, "Your leeway": what you can spend today, what that is a day,
// and how many days it has to last until payday. The figure is the server's
// spendable, the lesser of the budget's room and what is safe to spend from
// checking, and one line says which of the two sets it. Tapping it opens that
// one's math (lib/drills/leeway.ts); the figure never waits on that math,
// only the sheet does. When neither a budget nor a checking balance is
// known, it says so in words: nothing known is never $0.

import { Link } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { Card } from '../components/design/Card'
import { HeroFigure } from '../components/design/HeroFigure'
import { Money } from '../components/design/Money'
import { useApp } from '../lib/app'
import { isoDaysAgo } from '../lib/dates'
import { leewayDrillFor } from '../lib/drills/leeway'
import { dayLabel } from '../lib/format'
import { leewayLead, type LeewayLead } from '../lib/leewayLead'
import { settingsPath } from '../pages/settings/paths'
import { paths } from '../routes'
import type { WidgetProps } from './types'

/** With neither a budget nor a checking balance, there is nothing to go on yet: say so. */
function NothingKnown() {
  return (
    <Card static="words" label="Your leeway" className="hero stack">
      <p className="eyebrow">Your leeway</p>
      <p className="hero-figure-caption">
        Not known yet. Give a few categories a budget, or link a checking account, and this shows
        what you can spend.
      </p>
      <span className="row wrap">
        <Link to={paths.spending()} className="btn primary tap">
          Set budgets
        </Link>
        <Link to={settingsPath('banks')} className="btn tap">
          Link a bank
        </Link>
      </span>
    </Card>
  )
}

/**
 * "About $29 a day, with 10 days until payday Fri.": the server's figure a
 * day, then how long until payday, kept apart so the two never read as one
 * sum. Without a payday the budget sets both, to the end of its period.
 */
function PerDay({ lead }: { lead: LeewayLead }) {
  const { settings } = useApp()
  const { days, payday } = lead
  const dayWord = days === 1 ? 'day' : 'days'
  return (
    <>
      About{' '}
      <b>
        <Money cents={lead.perDayCents} />
      </b>{' '}
      a day
      {payday
        ? `, with ${days} ${dayWord} until payday ${dayLabel(payday, settings.locale)}.`
        : ` for the next ${days} ${dayWord}.`}
    </>
  )
}

/**
 * What sets the figure, in one line: the server's note when the cash sets it
 * or falls short (red only for a real problem), otherwise the budget, with
 * whether the cash was checked against it.
 */
function SetByLine({ lead }: { lead: LeewayLead }) {
  if (lead.note) {
    return <p className={`small ${lead.problem ? 'over' : 'muted'}`}>{lead.note}</p>
  }
  const words = lead.cashKnown ? 'Set by your budget; your cash covers it.' : 'Set by your budget.'
  return <p className="small muted">{words}</p>
}

export function LeewayWidget({ budget }: WidgetProps) {
  const { money, settings } = useApp()
  const lead = leewayLead(budget, isoDaysAgo(0, settings.timeZone))
  // Read only when the cash sets the figure, for the sheet alone; it shares
  // the cash card's read.
  const flow = useAction('get_cash_flow', {}, { enabled: lead?.setBy === 'cash' })
  if (!lead) return <NothingKnown />
  const date = (iso: string) => dayLabel(iso, settings.locale)
  const drill = leewayDrillFor(lead.setBy, budget, flow, money, date)
  // Past the budget, the room is negative: shown as how far over, in red.
  const over = lead.cents < 0
  return (
    <Card drill={drill} label="Your leeway" className="hero stack">
      <HeroFigure
        label={over ? 'Over budget' : 'Your leeway today'}
        cents={Math.abs(lead.cents)}
        tone={over || lead.problem ? 'problem' : undefined}
        caption={
          over ? (
            <>
              Past your <Money cents={budget.totals.budgetedCents} /> budget
            </>
          ) : (
            <PerDay lead={lead} />
          )
        }
      />
      <SetByLine lead={lead} />
    </Card>
  )
}
