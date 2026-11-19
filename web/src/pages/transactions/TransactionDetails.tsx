// The details view of a transaction's sheet: its amount and facts, its
// category and where that came from, a rule for ones like it, a note,
// leaving it out of totals, and the bank's own text tucked away below.

import { useState } from 'react'
import type { Category, Transaction } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { CategoryIcon } from '../../components/design/CategoryIcon'
import { Money } from '../../components/design/Money'
import { StatusPill } from '../../components/design/StatusPill'
import { ErrorNote, Icon, Switch } from '../../components/ui'
import { useApp } from '../../lib/app'
import { longDate, shortDate } from '../../lib/format'
import { amountSign, isMove, movementTag } from '../../lib/transactions'
import { useTransaction } from './useTransaction'

/** How a transaction got its category, in words. */
export function sourceText(tx: Pick<Transaction, 'categorySource' | 'transfer'>): string {
  if (tx.transfer && tx.categorySource === 'provider') return 'Matched with its other side'
  if (tx.categorySource === 'manual') return 'Set by you'
  if (tx.categorySource === 'rule') return 'Set by a rule'
  if (tx.categorySource === 'provider') return 'From your bank'
  return 'Not sorted yet'
}

export function TransactionDetails({
  tx,
  category,
  onChangeCategory,
  onMakeRule,
  onLetRulesDecide,
  onOpen,
  onDeleted,
}: {
  tx: Transaction
  category: Category | undefined
  onChangeCategory: () => void
  onMakeRule: () => void
  onLetRulesDecide: () => void
  onOpen: (tx: Transaction) => void
  onDeleted: () => void
}) {
  const kind = category?.kind ?? null
  const moved = isMove(kind)
  return (
    <>
      <div className="sheet-amount">
        <Money cents={tx.amountCents} sign={amountSign(kind)} size="xl" />
        <span className="sheet-amount-tags">
          {movementTag(tx, kind) && <StatusPill status="quiet" label={movementTag(tx, kind)!} />}
          {tx.excluded && <StatusPill status="quiet" label="Not counted in totals" />}
        </span>
      </div>

      <Facts tx={tx} onOpen={onOpen} />

      <section className="sheet-section" aria-label="Category">
        <h3 className="sheet-section-title">Category</h3>
        <button type="button" className="sheet-choice" onClick={onChangeCategory}>
          <CategoryIcon category={category} transfer={moved} size="sm" />
          <span className="sheet-choice-text">
            <span className="sheet-choice-name">{category?.name ?? 'Needs a category'}</span>
            <span className="sheet-choice-sub">{sourceText(tx)}</span>
          </span>
          <span className="sheet-choice-action">Change</span>
        </button>
        {tx.categorySource === 'manual' && (
          <button type="button" className="linkbtn small" onClick={onLetRulesDecide}>
            Let rules decide again
          </button>
        )}
        {!moved && (
          <button type="button" className="btn sheet-rule" onClick={onMakeRule}>
            <Icon name="sync" size={16} />
            <span>Always categorize {tx.displayName} as…</span>
          </button>
        )}
      </section>

      <MoreOptions key={tx.id} tx={tx} onDeleted={onDeleted} />
      <BankDetails tx={tx} />
    </>
  )
}

/** Date, account, status, and for a transfer, its other side. */
function Facts({ tx, onOpen }: { tx: Transaction; onOpen: (tx: Transaction) => void }) {
  const { settings } = useApp()
  return (
    <dl className="facts">
      <div>
        <dt>Date</dt>
        <dd>{longDate(tx.date, settings.locale)}</dd>
      </div>
      <div>
        <dt>Account</dt>
        <dd>{tx.accountName}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{tx.pending ? 'Pending' : 'Posted'}</dd>
      </div>
      {tx.transfer && (
        <OtherSide transfer={tx.transfer} outgoing={tx.amountCents > 0} onOpen={onOpen} />
      )}
    </dl>
  )
}

/** "Moved to: BOK Savings, Nov 18", a button that opens that side's sheet. */
function OtherSide({
  transfer,
  outgoing,
  onOpen,
}: {
  transfer: NonNullable<Transaction['transfer']>
  /** Whether money left this side, so the other side received it. */
  outgoing: boolean
  onOpen: (tx: Transaction) => void
}) {
  const { settings } = useApp()
  const partner = useTransaction(transfer)
  return (
    <div>
      <dt>{outgoing ? 'Moved to' : 'Moved from'}</dt>
      <dd>
        <button
          type="button"
          className="linkbtn"
          aria-label={`Open the other side: ${transfer.accountName}, ${longDate(transfer.date, settings.locale)}`}
          disabled={!partner}
          onClick={() => partner && onOpen(partner)}
        >
          {transfer.accountName}, {shortDate(transfer.date, settings.locale)}
        </button>
      </dd>
    </div>
  )
}

/** A note, leaving it out of totals, and deleting one added by hand. */
function MoreOptions({ tx, onDeleted }: { tx: Transaction; onDeleted: () => void }) {
  const [note, setNote] = useState(tx.note ?? '')
  const update = useActionMutation('update_transaction')
  const remove = useActionMutation('delete_transaction')
  return (
    <section className="sheet-section" aria-label="Note and totals">
      <label className="sheet-section-title" htmlFor={`note-${tx.id}`}>
        Note
      </label>
      <textarea
        id={`note-${tx.id}`}
        className="input sheet-note"
        rows={2}
        placeholder="Add a note"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => note !== (tx.note ?? '') && update.mutate({ id: tx.id, note: note || null })}
      />
      <div className="sheet-switch">
        <span>
          Leave out of totals
          <span className="sheet-choice-sub">Still listed, but not counted anywhere</span>
        </span>
        <Switch
          label="Leave out of totals"
          checked={tx.excluded}
          onChange={(excluded) => update.mutate({ id: tx.id, excluded })}
        />
      </div>
      {tx.manual && (
        <button
          type="button"
          className="btn danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ id: tx.id }, { onSuccess: onDeleted })}
        >
          Delete transaction
        </button>
      )}
      <ErrorNote error={update.error ?? remove.error} />
    </section>
  )
}

/** Where a transaction came from, as the bank sent it. Closed until wanted. */
function BankDetails({ tx }: { tx: Transaction }) {
  return (
    <details className="bank-details">
      <summary>Bank details</summary>
      <dl className="facts">
        <div>
          <dt>Description</dt>
          <dd className="bank-raw">{tx.name}</dd>
        </div>
        {tx.merchantName && (
          <div>
            <dt>Merchant</dt>
            <dd className="bank-raw">{tx.merchantName}</dd>
          </div>
        )}
        {tx.bankCategory && (
          <div>
            <dt>Bank category</dt>
            <dd className="bank-raw">{tx.bankCategory.toLowerCase().replaceAll('_', ' ')}</dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd>{SOURCES[tx.source]}</dd>
        </div>
      </dl>
    </details>
  )
}

const SOURCES: Record<Transaction['source'], string> = {
  bank: 'Your bank feed',
  manual: 'Added by hand',
  import: 'Imported from a file',
}
