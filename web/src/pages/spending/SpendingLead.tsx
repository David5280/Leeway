// What Spending leads with, answering "am I on budget?": what has gone out in
// your budgets this period, then the sum that shows it adding up: budgeted,
// minus spent, is what is left (or "Over by", in the over status). What is
// left is the budgets' room, never a figure to spend: Home's Leeway is the one
// of those, so cash and what goals hold back stay off this card. With no
// budget yet it says what was spent and offers the next step.

import type { Budget } from '../../api/client'
import { Card } from '../../components/design/Card'
import { KeyFigure } from '../../components/design/KeyFigure'
import { Money } from '../../components/design/Money'
import { SectionHead } from '../../components/design/SectionHead'
import { SumRow } from '../../components/design/SumRow'
import { useApp } from '../../lib/app'
import { budgetsDrill } from '../../lib/drills/spending'
import { periodLabel, periodWord } from '../../lib/format'
import { usedCaption } from './leadText'

const TITLE = 'Spent this period'

interface LeadProps {
  budget: Budget
  /** Opens the budget suggestions, the next step while nothing is budgeted. */
  onSuggest: () => void
}

export function SpendingLead({ budget, onSuggest }: LeadProps) {
  const { money, settings } = useApp()
  if (budget.totals.budgetedCents <= 0) return <NoBudgets budget={budget} onSuggest={onSuggest} />

  const { budgetedCents, budgetedSpentCents, leftCents } = budget.totals
  const over = leftCents < 0
  const label = periodLabel(budget.period.start, budget.period.end, settings.locale)
  return (
    <Card drill={budgetsDrill(budget, label, money)} label={TITLE} className="stack-sm">
      <SectionHead icon="moneyOut" title={TITLE} />
      <KeyFigure
        label="Spent in your budgets"
        cents={budgetedSpentCents}
        caption={usedCaption(budget, periodWord(settings.period.kind))}
      />
      <span className="playbook-rows">
        <span className="playbook-sum" role="group" aria-label="How your budgets add up">
          <SumRow name="Budgeted" cents={budgetedCents} />
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

/** Nothing budgeted: what went out, in words, and the way to set budgets. */
function NoBudgets({ budget, onSuggest }: LeadProps) {
  const { settings } = useApp()
  const current = budget.period.offset === 0
  const when = current
    ? `this ${periodWord(settings.period.kind)}`
    : `in ${periodLabel(budget.period.start, budget.period.end, settings.locale)}`
  return (
    <Card static="words" label={TITLE} className="stack-sm">
      <SectionHead icon="moneyOut" title={TITLE} />
      <p>
        {current ? "You've spent " : 'You spent '}
        <b>
          <Money cents={budget.totals.spentCents} />
        </b>{' '}
        {when}, with no budgets to measure it against yet.
      </p>
      <p className="small muted">
        Give a category a budget below, or start from what you usually spend.
      </p>
      <div className="row wrap">
        <button type="button" className="btn primary" onClick={onSuggest}>
          Suggest budgets
        </button>
      </div>
    </Card>
  )
}
