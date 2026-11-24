// The payday playbook (playbook/ on the server), at the top of Payday,
// general to detailed: what was left of the last paycheck, ideas for that
// leftover, then what the new paycheck covers before the next payday. Each
// card opens its math. Checking running low gets one line that opens the
// Bills section, where the full warning lives, and yearly costs are only
// totalled here because the Yearly costs card below explains them. The
// playbook only suggests: Leeway never moves money.

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
import { PlanRows } from './PlanRows'
import {
  hasCloseOut,
  ideaReason,
  leftoverLabel,
  leftoverTone,
  shortClass,
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

/** The big figure: what the paycheck leaves for everyday spending, or safe to spend without pay. */
function PlanFigure({ playbook }: { playbook: PlaybookView }) {
  const { settings } = useApp()
  const { plan } = playbook
  const payday = <b>{shortDate(plan.nextPayday, settings.locale)}</b>
  if (plan.paycheckCents === null || plan.leftCents === null) {
    return (
      <KeyFigure
        label="Safe to spend now"
        cents={plan.safeToSpendCents}
        caption={<>Add your pay below to see what each paycheck leaves before {payday}.</>}
      />
    )
  }
  return (
    <KeyFigure
      label="Left for everyday spending"
      cents={plan.leftCents}
      tone={plan.leftCents < 0 ? 'warn' : 'neutral'}
      caption={
        <>
          Your paycheck of <Money cents={plan.paycheckCents} tone="in" />, after what is due before{' '}
          {payday}.
        </>
      }
    />
  )
}

/** The new paycheck: what it covers before the next payday, and what it leaves. */
function ThisPaycheck({ playbook }: { playbook: PlaybookView }) {
  const { settings } = useApp()
  const date = (iso: string) => dayLabel(iso, settings.locale)
  return (
    <Card drill={planDrill(playbook.plan, date)} label="This paycheck" className="stack-sm">
      {/* No payday aside: the figure below already names it, and on a phone it crowds the title. */}
      <SectionHead icon="sunrise" title="This paycheck" />
      <PlanFigure playbook={playbook} />
      <PlanRows plan={playbook.plan} />
    </Card>
  )
}

/** Checking running low before payday, in one line that opens the full warning in Bills. */
function ShortCash({ playbook }: { playbook: PlaybookView }) {
  const { settings } = useApp()
  const short = playbook.plan.short
  if (!short) return null
  const zero = <Money cents={0} />
  return (
    <Card to="/plan/bills" label="Cash before payday" className="stack-xs">
      <p className={`small ${shortClass(playbook)}`}>
        {short.now ? (
          <>Checking is already below {zero}.</>
        ) : (
          <>
            Checking may go below {zero} on <b>{shortDate(short.date, settings.locale)}</b>, before
            payday.
          </>
        )}
      </p>
      <p className="small muted">See what would cover it in Bills.</p>
    </Card>
  )
}

/** The playbook's cards, each only when it has something to say. */
export function Playbook() {
  const playbook = usePaydayPlaybook()
  if (!playbook.data) return <LoadingOrError error={playbook.error} label="Loading your plan" />
  const data = playbook.data
  const leftover = data.closeOut?.leftoverCents ?? 0
  const ideas = leftover > 0 && data.suggestions.length > 0
  return (
    <>
      {hasCloseOut(data.closeOut) && <LastPaycheck closeOut={data.closeOut} ideas={ideas} />}
      {ideas && <LeftoverIdeas ideas={data.suggestions} leftover={leftover} />}
      <ThisPaycheck playbook={data} />
      <ShortCash playbook={data} />
    </>
  )
}
