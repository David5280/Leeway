// The form for adding or changing a bill or subscription.

import { useState, type FormEvent } from 'react'
import type { Bill, Category, Input } from '../../api/client'
import { CategorySelect } from '../../components/CategorySelect'
import { ErrorNote, Segmented, Setting, Switch } from '../../components/ui'
import { parseMoney } from '../../lib/format'
import { BILL_CADENCES, type BillCadence } from './text'

export type BillFields = Required<Input<'create_bill'>>

const KINDS = [
  { value: 'bill', label: 'Bill' },
  { value: 'subscription', label: 'Subscription' },
] as const

/** A bill's editable fields, or a starting point for a new one. */
export function billFields(bill: Partial<BillFields> = {}, today: string): BillFields {
  return {
    name: bill.name ?? '',
    kind: bill.kind ?? 'bill',
    amountCents: bill.amountCents ?? 0,
    cadence: bill.cadence ?? 'month',
    anchorDate: bill.anchorDate ?? today,
    matchPattern: bill.matchPattern ?? null,
    categoryId: bill.categoryId ?? null,
    autopay: bill.autopay ?? false,
  }
}

export function BillForm({
  bill,
  initial,
  categories,
  busy,
  error,
  onSubmit,
  onCancel,
  onDelete,
}: {
  bill?: Bill
  initial: BillFields
  categories: Category[]
  busy: boolean
  error: unknown
  onSubmit: (fields: BillFields) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [fields, setFields] = useState(initial)
  const [amount, setAmount] = useState(initial.amountCents ? String(initial.amountCents / 100) : '')
  const set = (change: Partial<BillFields>) => setFields((f) => ({ ...f, ...change }))
  const amountCents = parseMoney(amount)

  function submit(event: FormEvent) {
    event.preventDefault()
    const pattern = fields.matchPattern?.trim()
    onSubmit({ ...fields, amountCents: amountCents ?? 0, matchPattern: pattern || null })
  }

  return (
    <form className="stack" onSubmit={submit} aria-label={bill ? `Edit ${bill.name}` : 'New bill'}>
      <label className="field">
        Name
        <input
          className="input"
          required
          maxLength={80}
          value={fields.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <Setting label="Kind">
        <Segmented
          label="Kind"
          value={fields.kind}
          options={KINDS}
          onChange={(kind) => set({ kind })}
        />
      </Setting>
      <Setting label="Amount">
        <div className="row wrap">
          <input
            className="input num"
            style={{ width: 110 }}
            inputMode="decimal"
            required
            aria-label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <select
            className="input"
            style={{ width: 'auto' }}
            aria-label="How often"
            value={fields.cadence}
            onChange={(e) => set({ cadence: e.target.value as BillCadence })}
          >
            {Object.entries(BILL_CADENCES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </Setting>
      <Setting label="Next due" hint="Later dates repeat from this one">
        <input
          className="input"
          type="date"
          required
          aria-label="Next due"
          style={{ width: 'auto' }}
          value={fields.anchorDate}
          onChange={(e) => set({ anchorDate: e.target.value })}
        />
      </Setting>
      <label className="field">
        Shows on your statement as
        <input
          className="input"
          maxLength={200}
          placeholder="Like netflix. Blank skips checking for payments."
          value={fields.matchPattern ?? ''}
          onChange={(e) => set({ matchPattern: e.target.value })}
        />
      </label>
      <Setting label="Category" hint="Optional">
        <CategorySelect
          label="Category"
          emptyLabel="None"
          categories={categories.filter((c) => c.kind === 'expense')}
          value={fields.categoryId}
          onChange={(categoryId) => set({ categoryId })}
        />
      </Setting>
      <Setting label="Autopay" hint="Paid automatically, so it is never flagged as missed">
        <Switch label="Autopay" checked={fields.autopay} onChange={(autopay) => set({ autopay })} />
      </Setting>
      <ErrorNote error={error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy || !amountCents}>
          {bill ? 'Save' : 'Add bill'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button type="button" className="btn danger" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
