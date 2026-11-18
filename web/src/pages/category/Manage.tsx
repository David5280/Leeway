// Changing a category: its settings, its rules, and deleting it.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Category } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { CategoryForm } from '../../components/CategoryForm'
import { RuleBuilder } from '../../components/rules/RuleBuilder'
import { RulesList } from '../../components/rules/RulesList'
import type { RuleDraft } from '../../components/rules/rules'
import { Card, ErrorNote } from '../../components/ui'

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
    <Card label="Settings" className="span-wide stack">
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
    <Card label="Delete category" className="stack-sm">
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
