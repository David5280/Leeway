// Changing a category: its settings, its rules, and deleting it.

import { Card } from '../../components/design/Card'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Category } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { CategoryForm } from '../../components/CategoryForm'
import { RuleBuilder } from '../../components/rules/RuleBuilder'
import { RulesList } from '../../components/rules/RulesList'
import type { RuleDraft } from '../../components/rules/rules'
import { ErrorNote, Setting, Switch } from '../../components/ui'
import { useApp } from '../../lib/app'
import { longDate } from '../../lib/format'

export function CategorySettings({
  category,
  groups,
}: {
  category: Category
  /** Group names already in use, offered in the form. */
  groups: string[]
}) {
  const update = useActionMutation('update_category')
  return (
    <Card static="form" label="Settings" className="span-wide stack">
      <h2>Settings</h2>
      <CategoryForm
        category={category}
        groups={groups}
        submitLabel="Save changes"
        busy={update.isPending}
        error={update.error}
        onSubmit={(fields) => update.mutate({ id: category.id, ...fields })}
      />
      {update.isSuccess && <p className="small good">Saved.</p>}
    </Card>
  )
}

/**
 * Rollover: whether what is left at the end of a period (or overspent) carries
 * into the next one. Only spending categories with a budget have anything to carry.
 */
export function CategoryRollover({ category }: { category: Category }) {
  const { settings } = useApp()
  const update = useActionMutation('update_category')
  const noBudget = category.budgetCents === null
  return (
    <Card static="form" label="Rollover" className="stack-sm">
      <Setting
        label="Roll over what is left"
        hint={
          noBudget
            ? 'Give it a budget first, so there is something to carry'
            : 'Unspent money adds to next period, overspending takes from it'
        }
      >
        <Switch
          label="Roll over what is left"
          checked={category.rollover}
          disabled={noBudget || update.isPending}
          onChange={(rollover) => update.mutate({ id: category.id, rollover })}
        />
      </Setting>
      {category.rolloverSince && (
        <span className="small muted">
          Counting from {longDate(category.rolloverSince, settings.locale)}, when it was turned on.
        </span>
      )}
      <ErrorNote error={update.error} />
    </Card>
  )
}

/** This category's rules, with a builder that files new matches here. */
export function CategoryRules({
  category,
  categories,
}: {
  category: Category
  categories: Category[]
}) {
  const [rule, setRule] = useState<RuleDraft | null>(null)
  const blank: RuleDraft = {
    field: 'merchant',
    matchType: 'contains',
    pattern: '',
    categoryId: category.id,
  }
  return (
    <>
      {rule && <RuleBuilder initial={rule} categories={categories} onClose={() => setRule(null)} />}
      <RulesList categories={categories} categoryId={category.id} onNew={() => setRule(blank)} />
    </>
  )
}

/** Deleting asks once more, since a category's rules go with it. */
export function DeleteCategory({ category }: { category: Category }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const remove = useActionMutation('delete_category')
  return (
    <Card static="form" label="Delete category" className="stack-sm">
      <h2>Delete</h2>
      <span className="small muted">
        Its rules go too. Its transactions fall back to your other rules and bank categories.
      </span>
      <div className="row">
        {confirming ? (
          <>
            <button
              type="button"
              className="btn danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate({ id: category.id }, { onSuccess: () => navigate('/budgets') })
              }
            >
              Delete {category.name}
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            Delete category
          </button>
        )}
      </div>
      <ErrorNote error={remove.error} />
    </Card>
  )
}
