// Building a rule with a live preview of what it would catch.

import { useState, type FormEvent } from 'react'
import type { Category, Output } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { useApp } from '../../lib/app'
import { useDebounced } from '../../lib/useDebounced'
import { CategorySelect } from '../CategorySelect'
import { ErrorNote, Icon, Segmented } from '../ui'
import { UnreadableAmount } from '../UnreadableAmount'
import { amountLimits, FIELDS, MATCHES, type RuleDraft } from './rules'

/**
 * Builds a rule with a live preview of what it would catch, so nothing
 * surprising moves when it is saved.
 */
export function RuleBuilder({
  initial,
  categories,
  onClose,
  embedded = false,
}: {
  initial: RuleDraft
  categories: Category[]
  onClose: () => void
  /** Inside a sheet, which has its own frame and close button. */
  embedded?: boolean
}) {
  const [draft, setDraft] = useState(initial)
  const create = useActionMutation('create_rule')
  const set = (change: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...change }))
  const names = new Map(categories.map((c) => [c.id, c.name]))

  const { minAmountCents, maxAmountCents, unreadable: badLimit } = amountLimits(draft)
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

  return (
    <form
      className={embedded ? 'stack' : 'card soft stack'}
      onSubmit={submit}
      aria-label="New rule"
    >
      <div className="row-between">
        <h2>{initial.pattern ? `New rule from "${initial.pattern}"` : 'New rule'}</h2>
        {!embedded && (
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
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
      <AmountLimits draft={draft} onChange={set} />
      {preview.data && settled.pattern && (
        <RulePreview preview={preview.data} names={names} categoryId={draft.categoryId} />
      )}
      <ErrorNote error={create.error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn primary"
          disabled={!draft.categoryId || !draft.pattern.trim() || badLimit || create.isPending}
        >
          {create.isPending ? 'Saving' : 'Save rule and apply'}
        </button>
      </div>
    </form>
  )
}

/** Optional amount limits, hidden behind a link until wanted. */
function AmountLimits({
  draft,
  onChange,
}: {
  draft: RuleDraft
  onChange: (change: Partial<RuleDraft>) => void
}) {
  const [open, setOpen] = useState(Boolean(draft.minAmount || draft.maxAmount))
  if (!open) {
    return (
      <div>
        <button type="button" className="linkbtn" onClick={() => setOpen(true)}>
          Limit by amount
        </button>
      </div>
    )
  }
  return (
    <div className="row wrap">
      <span>Only when the amount is between</span>
      <AmountInput
        label="Smallest amount"
        value={draft.minAmount}
        onChange={(minAmount) => onChange({ minAmount })}
      />
      <span>and</span>
      <AmountInput
        label="Largest amount"
        value={draft.maxAmount}
        onChange={(maxAmount) => onChange({ maxAmount })}
      />
    </div>
  )
}

function AmountInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | undefined
  onChange: (value: string) => void
}) {
  return (
    <>
      <input
        className="input num"
        style={{ width: 100 }}
        inputMode="decimal"
        placeholder="Any"
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <UnreadableAmount text={value ?? ''} />
    </>
  )
}

/** "Matches 12 recent transactions. 3 would move to Groceries from Dining. For example: ..." */
function RulePreview({
  preview,
  names,
  categoryId,
}: {
  preview: Output<'preview_rule'>
  names: Map<string, string>
  categoryId: string | null
}) {
  const { exact } = useApp()
  const target = names.get(categoryId ?? '') ?? 'it'
  // Name where they come from only when they all come from one place.
  const only = preview.movingFrom.length === 1 ? preview.movingFrom[0]! : null
  const fromName = only?.categoryId
    ? (names.get(only.categoryId) ?? 'another category')
    : 'uncategorized'
  const from = only ? ` from ${fromName}` : ''
  const examples = preview.examples
    .slice(0, 3)
    .map((tx) => `${tx.merchantName ?? tx.name} (${exact(Math.abs(tx.amountCents))})`)
  return (
    <div className="notice small" aria-live="polite">
      Matches <strong className="num">{preview.matchCount}</strong> recent transactions.
      {preview.wouldMove > 0 && ` ${preview.wouldMove} would move to ${target}${from}.`}
      {examples.length > 0 && <span className="muted"> For example: {examples.join(', ')}.</span>}
    </div>
  )
}
