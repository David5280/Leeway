// The payday playbook (playbook/ on the server), Payday's lead: this
// paycheck, pay minus this pay period's bills minus what is set aside, which
// is what it leaves for everyday spending, the same all period. On payday
// (the few days after one lands) the close-out leads instead: what was left
// of the last paycheck and ideas for it, then this paycheck. Each card opens its math. What is set aside is
// only totalled here because the Goals tab explains it, and whether checking
// dips before payday is the cash line's job, just below. The playbook only
// suggests: Leeway never moves money.

import { Link } from 'react-router-dom'
import type { CloseOut, LeftoverSuggestion, Playbook as PlaybookView } from '../../../api/client'
import { usePaydayPlaybook } from '../../../api/playbook'
import { Card } from '../../../components/design/Card'
import { KeyFigure } from '../../../components/design/KeyFigure'
import { Money } from '../../../components/design/Money'
import { SectionHead } from '../../../components/design/SectionHead'
import { LoadingOrError } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { closeOutDrill, planDrill, suggestionsDrill } from '../../../lib/drills/playbook'
import { dayLabel, longDate, periodLabel, shortDate } from '../../../lib/format'
import { paths } from '../../../routes'
import { PlanRows } from './PlanRows'
import {
  hasCloseOut,
  ideaReason,
  leftoverLabel,
  leftoverTone,
  SUGGESTIONS_ONLY,
} from './playbookText'

/** The last paycheck closed out: the everyday budgets less what was spent. */
function LastPaycheck({ closeOut, ideas }: { closeOut: CloseOut; ideas: boolean }) {
  const { money, settings } = useApp()
  const period = periodLabel(closeOut.start, closeOut.end, settings.locale)
  const left = closeOut.leftoverCents
  return (
    <Card drill={closeOutDrill(closeOut, period, money)} label="Last paycheck" className="stack-sm">
      <SectionHead
        icon="wallet"
        title="Last paycheck"
        aside={<span className="small muted">{period}</span>}
      />
      <KeyFigure
        label={leftoverLabel(closeOut)}
        cents={Math.abs(left)}
        tone={leftoverTone(left)}
        caption={
          <>
            You spent{' '}
            <b>
              <Money cents={closeOut.spentCents} />
            </b>{' '}
            of the <Money cents={closeOut.budgetedCents} /> budgeted for everyday spending.
            {ideas && ' A few ideas for it are below.'}
          </>
        }
      />
    </Card>
  )
}

/** The leftover shared out over the ideas for it, most pressing first. */
function LeftoverIdeas({ ideas, leftover }: { ideas: LeftoverSuggestion[]; leftover: number }) {
  const { settings } = useApp()
  // A goal's target date can be a year or more away, so it keeps its year.
  const date = (iso: string) => longDate(iso, settings.locale)
  return (
    <Card
      drill={suggestionsDrill(ideas, leftover, date)}
      label="Ideas for what was left"
      className="stack-sm"
    >
      <SectionHead icon="target" title="Ideas for what was left" />
      <span className="playbook-rows">
        {ideas.map((idea, index) => (
          <span key={`${idea.kind}-${index}`} className="list-row">
            <span className="grow playbook-row-words">
              <span className="playbook-row-name">{idea.label}</span>
              <span className="small muted">{ideaReason(idea, date)}</span>
            </span>
            <b className="num">
              <Money cents={idea.amountCents} />
            </b>
          </span>
        ))}
      </span>
      <span className="small muted playbook-note">{SUGGESTIONS_ONLY}</span>
    </Card>
  )
}

/**
 * The big figure: what this paycheck leaves for everyday spending, which
 * holds still all pay period; or safe to spend while pay is unknown.
 */
function PlanFigure({ playbook }: { playbook: PlaybookView }) {
  const { settings } = useApp()
  const { plan } = playbook
  const payday = <b>{shortDate(plan.nextPayday, settings.locale)}</b>
  if (plan.paycheckCents === null || plan.everydayCents === null) {
    return (
      <KeyFigure
        label="Safe to spend now"
        cents={plan.safeToSpendCents}
        caption={<>Add your pay to see what each paycheck leaves before {payday}.</>}
      />
    )
  }
  return (
    <KeyFigure
      label="Left for everyday spending"
      cents={plan.everydayCents}
      tone={plan.everydayCents < 0 ? 'warn' : 'neutral'}
      caption={<>From this paycheck, until payday {payday}.</>}
    />
  )
}

/** The new paycheck: what it covers this pay period, and what it leaves. */
function ThisPaycheck({ playbook }: { playbook: PlaybookView }) {
  const { settings } = useApp()
  const date = (iso: string) => dayLabel(iso, settings.locale)
  return (
    <Card drill={planDrill(playbook.plan, date)} label="This paycheck" className="stack-sm">
      {/* No payday aside: the figure below already names it, and on a phone it crowds the title. */}
      <SectionHead icon="sunrise" title="This paycheck" />
      <PlanFigure playbook={playbook} />
      <PlanRows plan={playbook.plan} estimate={playbook.paydayEstimate} />
    </Card>
  )
}

/** While pay is unknown, the way to add it; outside the card, which is one button itself. */
function AddPay() {
  return (
    <p className="small">
      <Link to={paths.pay()} className="linkbtn">
        Add your pay
      </Link>
    </p>
  )
}

/**
 * The lead: this paycheck, or on payday the close-out first. Between paydays
 * the last period is old news, so it stays out of the way.
 */
export function Playbook() {
  const playbook = usePaydayPlaybook()
  if (!playbook.data) return <LoadingOrError error={playbook.error} label="Loading your plan" />
  const data = playbook.data
  const closeOut = data.justPaid && hasCloseOut(data.closeOut) ? data.closeOut : null
  const leftover = closeOut?.leftoverCents ?? 0
  const ideas = leftover > 0 && data.suggestions.length > 0
  return (
    <>
      {closeOut && <LastPaycheck closeOut={closeOut} ideas={ideas} />}
      {ideas && <LeftoverIdeas ideas={data.suggestions} leftover={leftover} />}
      <ThisPaycheck playbook={data} />
      {data.plan.paycheckCents === null && <AddPay />}
    </>
  )
}
