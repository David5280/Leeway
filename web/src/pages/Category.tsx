// One category in depth: this period, its history, its transactions and settings.

import { Link, useParams } from 'react-router-dom'
import type { Budget, Category, CategoryBudget } from '../api/client'
import { useAction } from '../api/hooks'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, Loading } from '../components/ui'
import { useApp } from '../lib/app'
import { groupNames } from '../lib/groups'
import { categoryStatus } from '../widgets/Categories'
import { History, InThisCategory } from './category/History'
import {
  CategoryRollover,
  CategoryRules,
  CategorySettings,
  DeleteCategory,
} from './category/Manage'
import { ThisPeriod } from './category/ThisPeriod'

export function CategoryPage() {
  const { id = '' } = useParams()
  const categories = useAction('list_categories')
  const budget = useAction('get_budget', { offset: 0 })
  const category = categories.data?.find((c) => c.id === id)

  if (categories.isSuccess && !category) {
    return (
      <Shell>
        <p className="empty">
          That category is gone. <Link to="/budgets">All categories</Link>
        </p>
      </Shell>
    )
  }
  if (!category || !budget.data) {
    return (
      <Shell>
        <ErrorNote error={categories.error ?? budget.error} />
        <Loading />
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
    />
  )
}

function CategoryDetail({
  category,
  categories,
  row,
  period,
}: {
  category: Category
  categories: Category[]
  row: CategoryBudget | undefined
  period: Budget['period']
}) {
  const { money } = useApp()
  const status = row ? categoryStatus(row, money) : null
  return (
    <Shell>
      <Link to="/budgets" className="linkbtn row" style={{ gap: 4 }}>
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
        {status && <span className={status.className}>{status.text}</span>}
        {category.kind === 'transfer' && (
          <span className="muted">Transfers never count toward spending or income.</span>
        )}
      </div>
      {row && <ThisPeriod category={category} row={row} period={period} />}
      <div className="grid">
        <History category={category} row={row} />
        <InThisCategory category={category} period={period} />
      </div>
      <div className="grid">
        <CategorySettings category={category} groups={groupNames(categories)} />
        <div className="span-half stack">
          {category.kind === 'expense' && <CategoryRollover category={category} />}
          <CategoryRules category={category} categories={categories} />
          <DeleteCategory category={category} />
        </div>
      </div>
    </Shell>
  )
}
