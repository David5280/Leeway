// The spending categories on the Budgets screen, in the order that reads
// best: under their group headings when any have one, otherwise budgeted
// categories first and the ones only tracked after.

import { Fragment } from 'react'
import type { Budget, Category, CategoryBudget } from '../../api/client'
import { groupBy } from '../../lib/groups'
import { BudgetRow } from './BudgetRow'

interface ListProps {
  rows: CategoryBudget[]
  budget: Budget
  /** Stored categories by id: the inline budget edits the category's own amount. */
  categories: Map<string, Category>
}

function Rows({ rows, budget, categories }: ListProps) {
  return rows.map((row) => {
    const category = categories.get(row.categoryId)
    // The two reads refresh apart; a category the list has not caught up on waits a moment.
    if (!category) return null
    return <BudgetRow key={row.categoryId} row={row} budget={budget} category={category} />
  })
}

/** Spending categories under their group headings, in order; ungrouped ones last. */
function GroupedRows(props: ListProps) {
  return groupBy(props.rows, (row) => row.group).map(({ group, items }) => (
    <Fragment key={group ?? ''}>
      <span className="eyebrow" style={{ marginTop: 12 }}>
        {group ?? 'Other'}
      </span>
      <Rows {...props} rows={items} />
    </Fragment>
  ))
}

/** Without groups: budgeted categories first, then the ones only tracked. */
function BudgetedThenTracked(props: ListProps) {
  const budgeted = props.rows.filter((row) => row.budgetCents !== null)
  const tracked = props.rows.filter((row) => row.budgetCents === null)
  return (
    <>
      <Rows {...props} rows={budgeted} />
      {tracked.length > 0 && (
        <>
          <span className="eyebrow" style={{ marginTop: 12 }}>
            Tracking only
          </span>
          <Rows {...props} rows={tracked} />
        </>
      )}
    </>
  )
}

export function SpendingList(props: ListProps) {
  if (props.rows.length === 0) return <p className="empty">No categories yet.</p>
  return props.rows.some((row) => row.group !== null) ? (
    <GroupedRows {...props} />
  ) : (
    <BudgetedThenTracked {...props} />
  )
}
