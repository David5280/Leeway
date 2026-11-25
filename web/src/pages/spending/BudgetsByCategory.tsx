// Budgets by category, Spending's middle: every spending category with its
// budget, which a tap on the amount changes in place, then income and
// transfers. A new category and budgets suggested from your spending start
// here too; each category opens its own page a tap deeper.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Budget, Category } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { CategoryForm } from '../../components/CategoryForm'
import { Card } from '../../components/design/Card'
import { SectionHead } from '../../components/design/SectionHead'
import { useApp } from '../../lib/app'
import { groupNames } from '../../lib/groups'
import { paths } from '../../routes'
import { SpendingList } from '../budgets/SpendingList'
import { Suggestions } from '../budgets/Suggestions'
import { IncomeAndTransfers } from './IncomeAndTransfers'

interface SectionProps {
  budget: Budget
  categories: Category[]
  /** Whether the suggestions are open: the lead opens them too while nothing is budgeted. */
  suggesting: boolean
  onSuggesting: (open: boolean) => void
}

export function BudgetsByCategory({ budget, categories, suggesting, onSuggesting }: SectionProps) {
  const [adding, setAdding] = useState(false)
  const expenses = budget.categories.filter((row) => row.kind === 'expense')
  return (
    <>
      {adding && <NewCategory categories={categories} onClose={() => setAdding(false)} />}
      {suggesting && <Suggestions onClose={() => onSuggesting(false)} />}
      <Card static="list" label="Spending categories" className="stack-sm cat-list">
        <SectionHead
          icon="budgets"
          title="Budgets by category"
          aside={<span className="small muted">Tap an amount to change it</span>}
        />
        <SpendingList
          rows={expenses}
          budget={budget}
          categories={new Map(categories.map((category) => [category.id, category]))}
        />
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            New category
          </button>
          <button type="button" className="btn" onClick={() => onSuggesting(!suggesting)}>
            Suggest from my spending
          </button>
        </div>
      </Card>
      <IncomeAndTransfers budget={budget} categories={categories} />
    </>
  )
}

/** The new category's form; a category once added opens on its own page. */
function NewCategory({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const { settings } = useApp()
  const navigate = useNavigate()
  const create = useActionMutation('create_category')
  return (
    <Card static="form" label="New category" className="stack">
      <h2>New category</h2>
      <CategoryForm
        groups={groupNames(categories, settings.locale)}
        submitLabel="Add category"
        busy={create.isPending}
        error={create.error}
        onCancel={onClose}
        onSubmit={(fields) =>
          create.mutate(fields, { onSuccess: (category) => navigate(paths.category(category.id)) })
        }
      />
    </Card>
  )
}
