// Bills and subscriptions: what is due and when, and repeating charges found
// in history, each tracked as a bill in one tap, with Undo in a toast.

import { Card } from '../../components/design/Card'
import { useCallback, useState } from 'react'
import type { Bill, Category } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { Toast } from '../../components/Toast'
import { ErrorNote, LoadingOrError } from '../../components/ui'
import { useApp } from '../../lib/app'
import { isoDaysAgo } from '../../lib/dates'
import { shortDate } from '../../lib/format'
import { FormCard } from './FormCard'
import { BillForm, billFields, type BillFields } from './BillForm'
import { BILL_CADENCES, billStatus } from './text'
import { Money } from '../../components/design/Money'

/** Which bill is open in the form: a new one or an existing one. */
type Editing = { bill?: Bill; initial: BillFields } | null

function BillRow({ bill, onEdit }: { bill: Bill; onEdit: () => void }) {
  const { settings } = useApp()
  const status = billStatus(bill, settings.locale)
  return (
    <button type="button" className="list-row" onClick={onEdit}>
      <span className="grow stack-sm" style={{ gap: 0, textAlign: 'left' }}>
        <span style={{ fontWeight: 500 }}>{bill.name}</span>
        <span className="small muted">
          {BILL_CADENCES[bill.cadence]}
          {bill.kind === 'subscription' ? ' subscription' : ''}
          {bill.autopay ? ', autopay' : ''}
        </span>
      </span>
      <span className="stack-sm" style={{ gap: 0, textAlign: 'right' }}>
        <Money cents={bill.amountCents} precision="cents" />
        <span className={`small ${status.tone || 'muted'}`}>{status.text}</span>
      </span>
    </button>
  )
}

/**
 * Repeating charges not tracked yet, each one tap from becoming a bill: the
 * bill takes the name, usual amount, due day, cadence and account found
 * (track_recurring), and a toast offers Undo. It can be changed in Bills after.
 */
function Suggestions() {
  const { settings } = useApp()
  const found = useAction('find_recurring')
  const dismiss = useActionMutation('dismiss_recurring')
  const track = useActionMutation('track_recurring')
  const undo = useActionMutation('delete_bill')
  const [tracked, setTracked] = useState<Bill | null>(null)
  // Stable, so the toast's timer is not restarted by each render.
  const closeToast = useCallback(() => setTracked(null), [])
  // Paychecks show up here too; they shape the payday, not the bills.
  const charges = found.data?.filter((s) => s.direction === 'out') ?? []
  const toast = tracked && (
    <Toast
      key={tracked.id}
      message={`${tracked.name} added to Bills`}
      actionLabel="Undo"
      onAction={() => {
        undo.mutate({ id: tracked.id })
        setTracked(null)
      }}
      onClose={closeToast}
    />
  )
  if (found.error) return <ErrorNote error={found.error} />
  // The toast sits beside the card, so it stays put when tracking the last charge empties it.
  return (
    <>
      {charges.length > 0 && (
        <Card static="list" label="Found in your history" className="stack-sm">
          <h2>Found in your history</h2>
          <p className="small muted">
            These repeat on a schedule but are not tracked as bills yet.
          </p>
          <ErrorNote error={dismiss.error ?? track.error} />
          {charges.map((series) => (
            <div key={series.key} className="list-row wrap">
              <span className="grow stack-sm" style={{ gap: 0 }}>
                <span style={{ fontWeight: 500 }}>{series.name}</span>
                <span className="small muted">
                  {series.amountVaries ? 'About ' : ''}
                  <Money cents={series.typicalAmountCents} precision="cents" />{' '}
                  {BILL_CADENCES[series.cadence].toLowerCase()}, next around{' '}
                  {shortDate(series.nextDate, settings.locale)}
                </span>
              </span>
              <button
                type="button"
                className="btn"
                disabled={track.isPending}
                onClick={() => track.mutate({ key: series.key }, { onSuccess: setTracked })}
              >
                Track
              </button>
              <button
                type="button"
                className="btn"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate({ key: series.key })}
              >
                Not a bill
              </button>
            </div>
          ))}
        </Card>
      )}
      {/* Undo's error takes the toast's place, so it shows even once the card has gone. */}
      {toast || <ErrorNote error={undo.error} />}
    </>
  )
}

/**
 * What saving an existing bill sends: every field, but the amount only when
 * the owner changed it. The server takes a sent amount as one the owner set,
 * and a form opened before Leeway settled a new amount would send the old one
 * back with a rename.
 */
function billUpdate(fields: BillFields, opened: BillFields): Partial<BillFields> {
  if (fields.amountCents !== opened.amountCents) return fields
  const { amountCents: _unchanged, ...rest } = fields
  return rest
}

/** The open form, with the changes it can save. */
function BillEditor({
  editing,
  categories,
  onClose,
}: {
  editing: NonNullable<Editing>
  categories: Category[]
  onClose: () => void
}) {
  const create = useActionMutation('create_bill')
  const update = useActionMutation('update_bill')
  const remove = useActionMutation('delete_bill')
  const { bill } = editing
  const close = { onSuccess: onClose }
  const save = (fields: BillFields) => {
    if (bill) update.mutate({ id: bill.id, ...billUpdate(fields, editing.initial) }, close)
    else create.mutate(fields, close)
  }
  return (
    <FormCard title={bill ? bill.name : 'New bill'}>
      <BillForm
        bill={bill}
        initial={editing.initial}
        categories={categories}
        busy={create.isPending || update.isPending || remove.isPending}
        error={create.error ?? update.error ?? remove.error}
        onSubmit={save}
        onCancel={onClose}
        onDelete={bill ? () => remove.mutate({ id: bill.id }, close) : undefined}
      />
    </FormCard>
  )
}

export function BillsSection() {
  const { settings } = useApp()
  const [editing, setEditing] = useState<Editing>(null)
  const bills = useAction('list_bills')
  const categories = useAction('list_categories')
  const today = isoDaysAgo(0, settings.timeZone)

  if (!bills.data || !categories.data) {
    const error = bills.error ?? categories.error
    return <LoadingOrError error={error} />
  }
  const { monthlyCents, subscriptionsMonthlyCents } = bills.data

  return (
    <>
      {editing && (
        <BillEditor
          // A new key resets the form when a different bill is opened.
          key={editing.bill?.id ?? editing.initial.name}
          editing={editing}
          categories={categories.data}
          onClose={() => setEditing(null)}
        />
      )}

      <Card static="list" label="Bills and subscriptions" className="stack-sm">
        <div className="row-between wrap">
          <div>
            <h2>Bills and subscriptions</h2>
            {monthlyCents > 0 && (
              <span className="small muted">
                About <Money cents={monthlyCents} /> a month, with{' '}
                <Money cents={subscriptionsMonthlyCents} /> in subscriptions
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => setEditing({ initial: billFields({}, today) })}
          >
            Add a bill
          </button>
        </div>
        {bills.data.bills.length === 0 && (
          <p className="empty">No bills yet. Add one, or track one found below.</p>
        )}
        {bills.data.bills.map((bill) => (
          <BillRow
            key={bill.id}
            bill={bill}
            onEdit={() => setEditing({ bill, initial: billFields(bill, today) })}
          />
        ))}
      </Card>

      <Suggestions />
    </>
  )
}
