// The rules in the order they run, with move and delete.

import type { Category, Rule } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { Dot, ErrorNote, Icon } from '../ui'
import { describeRule } from './rules'

/** The rules in run order, with move and delete. Pass categoryId to show one category's rules. */
export function RulesList({
  categories,
  categoryId,
  onNew,
}: {
  categories: Category[]
  categoryId?: string
  onNew: () => void
}) {
  const rules = useAction('list_rules')
  const reorder = useActionMutation('reorder_rules')
  const remove = useActionMutation('delete_rule')
  const byId = new Map(categories.map((c) => [c.id, c]))
  const all = rules.data ?? []
  const shown = categoryId ? all.filter((r) => r.categoryId === categoryId) : all

  function move(rule: Rule, by: -1 | 1) {
    const ids = all.map((r) => r.id)
    const from = ids.indexOf(rule.id)
    const to = from + by
    if (to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
    reorder.mutate({ ids })
  }

  return (
    <section className="card stack-sm" aria-label="Rules">
      <div className="row-between">
        <h2>{categoryId ? 'Rules' : 'Your rules'}</h2>
        <button type="button" className="linkbtn" onClick={onNew}>
          + New rule
        </button>
      </div>
      {rules.isSuccess && shown.length === 0 && (
        <p className="empty small">
          No rules yet. Open any transaction and pick "Always categorize" to file ones like it
          automatically.
        </p>
      )}
      {shown.map((rule) => {
        const category = byId.get(rule.categoryId)
        const index = all.indexOf(rule)
        return (
          <div key={rule.id} className="list-row">
            <span className="num small muted" style={{ width: 20 }}>
              {index + 1}
            </span>
            <span className="grow small">
              {describeRule(rule)}
              {(rule.minAmountCents !== null || rule.maxAmountCents !== null) && (
                <span className="muted"> (amount limited)</span>
              )}
            </span>
            <span className="row small" style={{ gap: 6 }}>
              <Dot color={category?.color} />
              {category?.name ?? 'Unknown'}
            </span>
            {!categoryId && (
              <>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={`Move rule ${index + 1} up`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(rule, -1)}
                >
                  <Icon name="up" size={16} />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={`Move rule ${index + 1} down`}
                  disabled={index === all.length - 1 || reorder.isPending}
                  onClick={() => move(rule, 1)}
                >
                  <Icon name="down" size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              className="iconbtn"
              aria-label={`Delete rule ${index + 1}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: rule.id })}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )
      })}
      <ErrorNote error={rules.error ?? reorder.error ?? remove.error} />
    </section>
  )
}
