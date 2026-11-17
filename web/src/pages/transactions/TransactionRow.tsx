// A transaction in the list, and its details when opened.

import { useState } from 'react'
import type { Category, Transaction } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { CategorySelect } from '../../components/CategorySelect'
import { Dot, ErrorNote, Switch } from '../../components/ui'
import { useApp } from '../../lib/app'

/** How a transaction got its category, in words. */
const SOURCES: Record<NonNullable<Transaction['categorySource']>, string> = {
  manual: 'by you',
  rule: 'by a rule',
  provider: 'from your bank',
}

/** One transaction: tap it for details, or change its category in place. */
export function TransactionRow({
  tx,
  category,
  categories,
  open,
  onToggle,
  onMakeRule,
}: {
  tx: Transaction
  category: Category | undefined
  categories: Category[]
  open: boolean
  onToggle: () => void
  onMakeRule: () => void
}) {
  const { signed } = useApp()
  const update = useActionMutation('update_transaction')
  return (
    <div className="list-row wrap" style={{ alignItems: 'flex-start' }}>
      <button
        type="button"
        className="grow linkbtn"
        style={{ textAlign: 'left', color: 'var(--ink)', minWidth: 160 }}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span style={{ fontWeight: 500 }}>{tx.merchantName ?? tx.name}</span>
        {tx.pending && <span className="small muted"> · pending</span>}
        <br />
        <span className="small muted">
          {tx.accountName}
          {tx.note ? ` · ${tx.note}` : ''}
        </span>
      </button>
      <span className="stack-sm" style={{ gap: 2, width: 200 }}>
        <span className="row" style={{ gap: 6 }}>
          <Dot color={category?.color} dashed={!category} />
          <CategorySelect
            categories={categories}
            value={tx.categoryId}
            label={`Category for ${tx.merchantName ?? tx.name}`}
            emptyLabel="Needs a category"
            disabled={update.isPending}
            onChange={(categoryId) => update.mutate({ id: tx.id, categoryId })}
          />
        </span>
        <span className="small muted row-between">
          {tx.categorySource ? SOURCES[tx.categorySource] : 'not sorted yet'}
          <button type="button" className="linkbtn small" onClick={onMakeRule}>
            Make a rule
          </button>
        </span>
      </span>
      <span
        className={tx.amountCents < 0 ? 'num good' : 'num'}
        style={{ width: 100, textAlign: 'right', fontWeight: 600 }}
      >
        {signed(tx.amountCents)}
      </span>
      {open && <TransactionDetail tx={tx} />}
      <ErrorNote error={update.error} />
    </div>
  )
}

/** Note, leave out of totals, hand back to rules, and delete for ones added by hand. */
function TransactionDetail({ tx }: { tx: Transaction }) {
  const [note, setNote] = useState(tx.note ?? '')
  const update = useActionMutation('update_transaction')
  const remove = useActionMutation('delete_transaction')
  return (
    <div className="card soft stack-sm" style={{ flexBasis: '100%' }}>
      <div className="row wrap">
        <input
          className="input grow"
          placeholder="Add a note"
          aria-label="Note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() =>
            note !== (tx.note ?? '') && update.mutate({ id: tx.id, note: note || null })
          }
        />
        <label className="row small">
          <Switch
            label="Leave out of totals"
            checked={tx.excluded}
            onChange={(excluded) => update.mutate({ id: tx.id, excluded })}
          />
          Leave out of totals
        </label>
        {tx.categorySource === 'manual' && (
          <button
            type="button"
            className="linkbtn small"
            onClick={() => update.mutate({ id: tx.id, categoryId: null })}
          >
            Let rules decide again
          </button>
        )}
        {tx.manual && (
          <button
            type="button"
            className="btn danger small"
            onClick={() => remove.mutate({ id: tx.id })}
          >
            Delete
          </button>
        )}
      </div>
      {tx.bankCategory && (
        <span className="small muted">
          Your bank calls this {tx.bankCategory.toLowerCase().replaceAll('_', ' ')}.
        </span>
      )}
      <ErrorNote error={update.error ?? remove.error} />
    </div>
  )
}
