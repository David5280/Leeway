import { useState, type FormEvent } from 'react'
import type { Category, Rule } from '../api/client'
import { useAction, useActionMutation } from '../api/hooks'
import { useApp } from '../lib/app'
import { parseMoney } from '../lib/format'
import { useDebounced } from '../lib/useDebounced'
import { Dot, ErrorNote, Icon, Segmented } from './ui'

export interface RuleDraft {
  field: Rule['field']
  matchType: Rule['matchType']
  pattern: string
  categoryId: string | null
  minAmount?: string
  maxAmount?: string
}

const FIELDS = [
  { value: 'merchant', label: 'merchant' },
  { value: 'description', label: 'description' },
] as const

const MATCHES = { contains: 'contains', equals: 'is exactly', starts_with: 'starts with' } as const

/** The categories a rule can file into: everything but income and transfers stays available too. */
export function CategorySelect({
  categories,
  value,
  onChange,
  label,
  emptyLabel,
  disabled,
}: {
  categories: Category[]
  value: string | null
  onChange: (id: string | null) => void
  label: string
  emptyLabel?: string
  disabled?: boolean
}) {
  return (
    <select
      className="input"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {emptyLabel === undefined && value === null && (
        <option value="" disabled>
          Pick a category
        </option>
      )}
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

export function describeRule(rule: Pick<Rule, 'field' | 'matchType' | 'pattern'>): string {
  return `${rule.field === 'merchant' ? 'Merchant' : 'Description'} ${MATCHES[rule.matchType]} "${rule.pattern}"`
}

/**
 * Builds a rule with a live preview of what it would catch, so nothing
 * surprising moves when it is saved.
 */
export function RuleBuilder({
  initial,
  categories,
  onClose,
}: {
  initial: RuleDraft
  categories: Category[]
  onClose: () => void
}) {
  const { exact } = useApp()
  const [draft, setDraft] = useState(initial)
  const [showAmounts, setShowAmounts] = useState(Boolean(initial.minAmount || initial.maxAmount))
  const create = useActionMutation('create_rule')
  const set = (change: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...change }))
  const names = new Map(categories.map((c) => [c.id, c.name]))

  const minAmountCents = draft.minAmount ? parseMoney(draft.minAmount) : null
  const maxAmountCents = draft.maxAmount ? parseMoney(draft.maxAmount) : null
  const settled = useDebounced({
    field: draft.field,
    matchType: draft.matchType,
    pattern: draft.pattern.trim(),
    categoryId: draft.categoryId,
    minAmountCents,
    maxAmountCents,
  })
  const preview = useAction('preview_rule', settled, { enabled: settled.pattern.length > 0 })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft.categoryId) return
    create.mutate(
      {
        field: draft.field,
        matchType: draft.matchType,
        pattern: draft.pattern.trim(),
        categoryId: draft.categoryId,
        minAmountCents,
        maxAmountCents,
      },
      { onSuccess: onClose },
    )
  }

  const p = preview.data
  return (
    <form className="card soft stack" onSubmit={submit} aria-label="New rule">
      <div className="row-between">
        <h2>{initial.pattern ? `New rule from "${initial.pattern}"` : 'New rule'}</h2>
        <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p className="small muted">
        Rules run top to bottom. The first match wins, and your own picks always win over rules.
      </p>
      <div className="row wrap">
        <span>When the</span>
        <Segmented
          label="Match on"
          value={draft.field}
          options={FIELDS}
          onChange={(field) => set({ field })}
        />
        <select
          className="input"
          aria-label="How it matches"
          style={{ width: 'auto' }}
          value={draft.matchType}
          onChange={(e) => set({ matchType: e.target.value as RuleDraft['matchType'] })}
        >
          {Object.entries(MATCHES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input grow"
          style={{ minWidth: 160 }}
          aria-label="Text to match"
          required
          value={draft.pattern}
          onChange={(e) => set({ pattern: e.target.value })}
        />
        <span>put it in</span>
        <div style={{ minWidth: 180 }}>
          <CategorySelect
            categories={categories}
            value={draft.categoryId}
            label="Category for matches"
            onChange={(categoryId) => set({ categoryId })}
          />
        </div>
      </div>
      {showAmounts ? (
        <div className="row wrap">
          <span>Only when the amount is between</span>
          <input
            className="input num"
            style={{ width: 100 }}
            inputMode="decimal"
            placeholder="Any"
            aria-label="Smallest amount"
            value={draft.minAmount ?? ''}
            onChange={(e) => set({ minAmount: e.target.value })}
          />
          <span>and</span>
          <input
            className="input num"
            style={{ width: 100 }}
            inputMode="decimal"
            placeholder="Any"
            aria-label="Largest amount"
            value={draft.maxAmount ?? ''}
            onChange={(e) => set({ maxAmount: e.target.value })}
          />
        </div>
      ) : (
        <div>
          <button type="button" className="linkbtn" onClick={() => setShowAmounts(true)}>
            Limit by amount
          </button>
        </div>
      )}
      {p && settled.pattern && (
        <div className="notice small" aria-live="polite">
          Matches <strong className="num">{p.matchCount}</strong> recent transactions.
          {p.wouldMove > 0 &&
            ` ${p.wouldMove} would move to ${names.get(draft.categoryId ?? '') ?? 'it'}${
              p.movingFrom.length === 1
                ? ` from ${p.movingFrom[0]!.categoryId ? (names.get(p.movingFrom[0]!.categoryId) ?? 'another category') : 'uncategorized'}`
                : ''
            }.`}
          {p.examples.length > 0 && (
            <span className="muted">
              {' '}
              For example:{' '}
              {p.examples
                .slice(0, 3)
                .map((tx) => `${tx.merchantName ?? tx.name} (${exact(Math.abs(tx.amountCents))})`)
                .join(', ')}
              .
            </span>
          )}
        </div>
      )}
      <ErrorNote error={create.error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn primary"
          disabled={!draft.categoryId || create.isPending}
        >
          {create.isPending ? 'Saving' : 'Save rule and apply'}
        </button>
      </div>
    </form>
  )
}

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
          No rules yet. Pick "Make a rule" on any transaction to file ones like it automatically.
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
