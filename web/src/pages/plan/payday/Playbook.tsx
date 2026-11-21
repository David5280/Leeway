// The payday playbook (playbook/ on the server), the top of Payday: first
// what was left of the everyday budgets from the last paycheck, big and
// green when there is money left, then a plan for the new paycheck, every
// dollar given a job in priority order. Each card opens its math. The plan
// only suggests: Leeway never moves money.

import type { PaycheckPlan, Playbook as PlaybookView, PlanStep } from '../../../api/client'
import { useAction } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { KeyFigure } from '../../../components/design/KeyFigure'
import { Money } from '../../../components/design/Money'
import { SectionHead } from '../../../components/design/SectionHead'
import { LoadingOrError } from '../../../components/ui'
import { useApp } from '../../../lib/app'
import { closeOutDrill, planDrill } from '../../../lib/drills/playbook'
import { dayLabel, periodLabel } from '../../../lib/format'
import { hasCloseOut, leftoverLabel, leftoverTone, STEP_WORDS, stepDetail } from './playbookText'

/** What the leftover means next: it joins the plan, or pay is needed to plan it. */
function nextWords(leftoverCents: number, planned: boolean): string {
  if (!planned) return 'Add your pay below to plan what to do with it.'
  if (leftoverCents > 0) return 'It is added to the plan for your paycheck below.'
  return leftoverCents < 0 ? 'The plan below makes up for it.' : ''
}

/** The last paycheck closed out: the everyday budgets less what was spent. */
function CloseOutCard({ playbook }: { playbook: PlaybookView }) {
  const { money, settings } = useApp()
  const { closeOut } = playbook
  const period = periodLabel(closeOut.start, closeOut.end, settings.locale)
  const left = closeOut.leftoverCents
  return (
    <Card
      drill={closeOutDrill(closeOut, period, money)}
      label="Your last paycheck"
      className="stack-sm"
    >
      <SectionHead
        icon="wallet"
        title="Your last paycheck"
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
            of the <Money cents={closeOut.budgetedCents} /> budgeted for everyday spending.{' '}
            {nextWords(left, playbook.plan !== null)}
          </>
        }
      />
    </Card>
  )
}

/** One step of the plan: its name, what it pays for, and what it gets. */
function StepRow({ step }: { step: PlanStep }) {
  const short = step.amountCents < step.needCents
  return (
    <span className="list-row">
      <span className="grow stack-sm" style={{ gap: 0 }}>
        <span style={{ fontWeight: 500 }}>{STEP_WORDS[step.key]}</span>
        <span className="small muted">{stepDetail(step)}</span>
      </span>
      <span className="num plan-amount">
        <Money cents={step.amountCents} />
        {short && (
          <span className="small muted">
            of <Money cents={step.needCents} />
          </span>
        )}
      </span>
    </span>
  )
}

/** A plan that does not cover everything says so; the bills falling short is the one problem. */
function ShortNote({ plan }: { plan: PaycheckPlan }) {
  if (plan.shortCents <= 0) return null
  return plan.billsShort ? (
    <span className="small over plan-note">
      Not enough for the bills before payday. <Money cents={plan.shortCents} /> short in all.
    </span>
  ) : (
    <span className="small muted plan-note">
      <Money cents={plan.shortCents} /> short of everything, so the last steps get less.
    </span>
  )
}

/** The new paycheck's plan, most pressing step first. */
function PlanCard({ playbook, plan }: { playbook: PlaybookView; plan: PaycheckPlan }) {
  const { settings } = useApp()
  const date = (iso: string) => dayLabel(iso, settings.locale)
  const paycheck = playbook.paycheck!
  const left = plan.leftoverCents
  return (
    <Card
      drill={planDrill(plan, date)}
      label="Paycheck plan"
      className={`stack-sm${plan.billsShort ? ' over-card' : ''}`}
    >
      <SectionHead
        icon="sunrise"
        title={playbook.justPaid ? 'Payday! Here is a plan' : 'Plan for your next paycheck'}
      />
      <KeyFigure
        label="To plan"
        cents={plan.toPlanCents}
        caption={
          <>
            {paycheck.landed ? 'Your paycheck of ' : 'Your next paycheck of '}
            <Money cents={paycheck.amountCents} tone="in" />
            {paycheck.landed ? ' landed ' : ' lands '}
            <b>{date(paycheck.date)}</b>
            {left > 0 && (
              <>
                , plus <Money cents={left} /> left over
              </>
            )}
            {left < 0 && (
              <>
                , less <Money cents={-left} /> over budget
              </>
            )}
            .
          </>
        }
      />
      <span className="plan-steps">
        {plan.steps.map((step) => (
          <StepRow key={step.key} step={step} />
        ))}
      </span>
      <ShortNote plan={plan} />
      <span className="small muted plan-note">Suggestions only. You move the money yourself.</span>
    </Card>
  )
}

/** The playbook's two cards, each only when it has something to say. */
export function Playbook() {
  const playbook = useAction('get_payday_playbook')
  if (!playbook.data) return <LoadingOrError error={playbook.error} label="Loading your plan" />
  const data = playbook.data
  return (
    <>
      {hasCloseOut(data.closeOut) && <CloseOutCard playbook={data} />}
      {data.plan && <PlanCard playbook={data} plan={data.plan} />}
    </>
  )
}
