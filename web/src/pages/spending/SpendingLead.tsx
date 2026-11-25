// What Spending leads with, answering "am I on budget?": what has gone out in
// your budgets in the period on screen, then the sum that shows it adding up:
// budgeted, minus spent, is what is left (or "Over by", in the over status).
// What is left is the budgets' room, never a figure to spend: Home's Leeway is
// the one of those, so cash and what goals hold back stay off this card.
// Leeway keeps no budget history, so a past period is measured against
// today's budgets, and the card says so. With no budget yet it says what was
// spent and, for the period still running, offers the next step.

import type { Budget } from '../../api/client'
import { Card } from '../../components/design/Card'
import { KeyFigure } from '../../components/design/KeyFigure'
import { Money } from '../../components/design/Money'
import { SectionHead } from '../../components/design/SectionHead'
import { SumRow } from '../../components/design/SumRow'
import { useApp } from '../../lib/app'
import { budgetsDrill } from '../../lib/drills/spending'
import { periodLabel, periodWord } from '../../lib/format'
import { hasBudgets, leadTitle, usedCaption } from './leadText'

interface LeadProps {
  budget: Budget
  /** Opens the budget suggestions, the next step while nothing is budgeted. */
  onSuggest: () => void
}

export function SpendingLead({ budget, onSuggest }: LeadProps) {
  const { money, settings } = useApp()
  const word = periodWord(settings.period.kind)
  const title = leadTitle(budget, word, settings.locale)
  if (!hasBudgets(budget)) return <NoBudgets budget={budget} title={title} onSuggest={onSuggest} />

  const { budgetedCents, budgetedSpentCents, leftCents } = budget.totals
  const over = leftCents < 0
  const past = budget.period.offset !== 0
  const label = periodLabel(budget.period.start, budget.period.end, settings.locale)
  return (
    <Card drill={budgetsDrill(budget, label, money)} label={title} className="stack-sm">
      <SectionHead icon="moneyOut" title={title} />
      <KeyFigure
        label="Spent in your budgets"
        cents={budgetedSpentCents}
        caption={usedCaption(budget, word)}
      />
      <span className="playbook-rows">
        <span className="playbook-sum" role="group" aria-label="How your budgets add up">
          {/* No budget history is kept, so looking back uses today's budgets, said plainly. */}
          <SumRow
            name={past ? "Today's budgets" : 'Budgeted'}
            detail={past ? 'Leeway keeps no budget history' : undefined}
            cents={budgetedCents}
          />
          <SumRow name="Spent" cents={budgetedSpentCents} sum="minus" />
          {/* Gone past the budgets: the over status, said in words, never a bare minus. */}
          <SumRow
            name={over ? 'Over by' : 'Left'}
            cents={Math.abs(leftCents)}
            tone={over ? 'problem' : undefined}
            className="playbook-total"
          />
        </span>
      </span>
    </Card>
  )
}

/** Nothing budgeted: what went out, in words, and for now the way to set budgets. */
function NoBudgets({ budget, title, onSuggest }: LeadProps & { title: string }) {
  const { settings } = useApp()
  const current = budget.period.offset === 0
  const spent = (
    <b>
      <Money cents={budget.totals.spentCents} />
    </b>
  )
  return (
    <Card static="words" label={title} className="stack-sm">
      <SectionHead icon="moneyOut" title={title} />
      {current ? (
        <p>
          You&apos;ve spent {spent} this {periodWord(settings.period.kind)}, with no budgets to
          measure it against yet.
        </p>
      ) : (
        <p>You spent {spent}, with no budgets to measure it against.</p>
      )}
      {/* Budgets are set for now: a change made while looking back would change today's. */}
      {current && (
        <>
          <p className="small muted">
            Give a category a budget below, or start from what you usually spend.
          </p>
          <div className="row wrap">
            <button type="button" className="btn primary" onClick={onSuggest}>
              Suggest budgets
            </button>
          </div>
        </>
      )}
    </Card>
  )
}
