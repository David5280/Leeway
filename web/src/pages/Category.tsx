// One category in depth: this period, its history, its transactions and settings.
// Opened from a past period on Spending (?period=-1), it shows that period's
// figures and leads back to it. Leeway keeps no budget history, so there the
// budget is shown but not changed: a change would change today's budget.
// Its other settings, rules and rollover are not per period, so they stay.

import { Link, useParams } from 'react-router-dom'
import type { Budget, Category, CategoryBudget } from '../api/client'
import { useAction } from '../api/hooks'
import { useScreenName } from '../components/ask/AskProvider'
import { Shell } from '../components/Shell'
import { Icon, LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel, periodWord } from '../lib/format'
import { groupNames } from '../lib/groups'
import { categoryStatus } from '../lib/categoryStatus'
import { History, InThisCategory } from './category/History'
import {
  CategoryRollover,
  CategoryRules,
  CategorySettings,
  DeleteCategory,
} from './category/Manage'
import { ThisPeriod } from './category/ThisPeriod'
import { useSpendingPeriod } from './spending/period'
import { paths } from '../routes'

export function CategoryPage() {
  const { id = '' } = useParams()
  const [offset] = useSpendingPeriod()
  const categories = useAction('list_categories')
  const budget = useAction('get_budget', { offset })
  const category = categories.data?.find((c) => c.id === id)
  // Ask Leeway names the category, not only its kind: "Ask about Category: Groceries".
  useScreenName(category && `Category: ${category.name}`)

  if (categories.isSuccess && !category) {
    return (
      <Shell>
        <p className="empty">
          That category is gone. <Link to={paths.spending(offset)}>All categories</Link>
        </p>
      </Shell>
    )
  }
  if (!category || !budget.data) {
    return (
      <Shell>
        <LoadingOrError error={categories.error ?? budget.error} />
      </Shell>
    )
  }
  const row = budget.data.categories.find((c) => c.categoryId === id)
  return (
    <CategoryDetail
      key={category.id}
      category={category}
      categories={categories.data ?? []}
      row={row}
      period={budget.data.period}
      previousCents={
        budget.data.previous.categories.find((c) => c.categoryId === id)?.spentToDateCents ?? 0
      }
    />
  )
}

function CategoryDetail({
  category,
  categories,
  row,
  period,
  previousCents,
}: {
  category: Category
  categories: Category[]
  row: CategoryBudget | undefined
  period: Budget['period']
  /** This category's last period to the same day, for the trend. */
  previousCents: number
}) {
  const { money, settings } = useApp()
  const status = row ? categoryStatus(row, money) : null
  const past = period.offset !== 0
  const dates = periodLabel(period.start, period.end, settings.locale)
  // "this month" now, "in October 2026" looking back, for the figures that name it.
  const when = past ? `in ${dates}` : `this ${periodWord(settings.period.kind)}`
  return (
    <Shell>
      <Link to={paths.spending(period.offset)} className="linkbtn row" style={{ gap: 4 }}>
        <Icon name="back" size={16} /> All categories
      </Link>
      <div>
        <h1 className="row">
          <span
            className="dot"
            style={{ background: category.color, width: 14, height: 14 }}
            aria-hidden="true"
          />
          {category.name}
        </h1>
        {past && (
          <p className="muted">
            {dates}. Budgets are today&apos;s, so they change on the current period.
          </p>
        )}
        {status && <span className={status.className}>{status.text}</span>}
        {category.kind === 'transfer' && (
          <span className="muted">Transfers never count toward spending or income.</span>
        )}
      </div>
      {row && <ThisPeriod row={row} period={period} previousCents={previousCents} when={when} />}
      <div className="grid">
        <History category={category} row={row} />
        <InThisCategory category={category} period={period} when={when} />
      </div>
      <div className="grid">
        <CategorySettings
          category={category}
          groups={groupNames(categories, settings.locale)}
          budgetLocked={past}
        />
        <div className="span-half stack">
          {category.kind === 'expense' && <CategoryRollover category={category} />}
          <CategoryRules category={category} categories={categories} />
          <DeleteCategory category={category} />
        </div>
      </div>
    </Shell>
  )
}
