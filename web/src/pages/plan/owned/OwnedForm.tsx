// The form for something owned or owed by hand: what it is (for a new one),
// its name and amount, a loan's rate and monthly payment, and for something
// owned the loan against it. Removing one deletes the manual account.

import { useState, type FormEvent } from 'react'
import { useAction, useActionMutation } from '../../../api/hooks'
import { ErrorNote, Segmented, Setting } from '../../../components/ui'
import { isOwed } from '../../../lib/accounts'
import { parseMoney } from '../../../lib/format'
import {
  isOwedKind,
  NEW_KINDS,
  ownedText,
  type NewKind,
  type OwnedItem,
  type OwnedText,
} from './ownedText'

/** A typed number, or null for a blank field or one that is not a number. */
function percentOf(text: string): number | null {
  const value = Number(text.trim())
  return text.trim() === '' || !Number.isFinite(value) ? null : Math.round(value * 100) / 100
}

/** The loans something owned can name: every counted card or loan but itself. */
function useLoanChoices(itemId: string | undefined) {
  const accounts = useAction('list_accounts')
  return (accounts.data ?? []).filter(
    (account) => isOwed(account) && !account.hidden && account.id !== itemId,
  )
}

/** The fields that change with what it is: a loan's terms, or the loan against a thing owned. */
function KindFields({
  owed,
  text,
  loans,
  onChange,
}: {
  owed: boolean
  text: OwnedText
  loans: { id: string; name: string }[]
  onChange: (change: Partial<OwnedText>) => void
}) {
  if (owed) {
    return (
      <>
        <Setting label="Rate, %" hint="Optional. For debt payoff plans">
          <input
            className="input num"
            style={{ width: 100 }}
            inputMode="decimal"
            aria-label="Rate, %"
            value={text.rate}
            onChange={(e) => onChange({ rate: e.target.value })}
          />
        </Setting>
        <Setting label="Monthly payment" hint="Optional">
          <input
            className="input num"
            style={{ width: 130 }}
            inputMode="decimal"
            aria-label="Monthly payment"
            value={text.payment}
            onChange={(e) => onChange({ payment: e.target.value })}
          />
        </Setting>
      </>
    )
  }
  if (loans.length === 0) return null
  return (
    <Setting label="Loan on it" hint="Optional. Shows what is yours after it">
      <select
        className="input"
        aria-label="Loan on it"
        style={{ width: 'auto' }}
        value={text.loanId}
        onChange={(e) => onChange({ loanId: e.target.value })}
      >
        <option value="">None</option>
        {loans.map((loan) => (
          <option key={loan.id} value={loan.id}>
            {loan.name}
          </option>
        ))}
      </select>
    </Setting>
  )
}

export function OwnedForm({ item, onClose }: { item?: OwnedItem; onClose: () => void }) {
  const add = useActionMutation('add_owned_or_owed')
  const update = useActionMutation('update_owned_or_owed')
  const remove = useActionMutation('delete_account')
  const loans = useLoanChoices(item?.id)
  const [kind, setKind] = useState<NewKind>('home')
  const [text, setText] = useState<OwnedText>(() => ownedText(item))
  const owed = item ? isOwedKind(item.kind) : kind === 'loan'
  const amountCents = parseMoney(text.amount)
  const busy = add.isPending || update.isPending || remove.isPending
  const change = (next: Partial<OwnedText>) => setText((now) => ({ ...now, ...next }))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (amountCents === null) return
    const terms = owed
      ? { aprPercent: percentOf(text.rate), monthlyPaymentCents: parseMoney(text.payment) }
      : { loanId: text.loanId || null }
    const fields = { name: text.name, amountCents: Math.max(0, amountCents), ...terms }
    const close = { onSuccess: onClose }
    if (item) update.mutate({ id: item.id, ...fields }, close)
    else add.mutate({ kind, ...fields }, close)
  }

  return (
    <form
      className="stack"
      onSubmit={submit}
      aria-label={item ? `Edit ${item.name}` : 'Add something'}
    >
      {!item && (
        <Segmented label="What is it?" value={kind} options={NEW_KINDS} onChange={setKind} />
      )}
      <label className="field">
        Name
        <input
          className="input"
          required
          maxLength={80}
          placeholder={owed ? 'Like car loan' : 'Like our house'}
          value={text.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>
      <Setting label={owed ? 'Still owed' : 'Worth about'}>
        <input
          className="input num"
          style={{ width: 130 }}
          inputMode="decimal"
          required
          aria-label={owed ? 'Still owed' : 'Worth about'}
          value={text.amount}
          onChange={(e) => change({ amount: e.target.value })}
        />
      </Setting>
      <KindFields owed={owed} text={text} loans={loans} onChange={change} />
      <ErrorNote error={add.error ?? update.error ?? remove.error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={busy || amountCents === null}>
          {item ? 'Save' : 'Add'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        {item && (
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => remove.mutate({ id: item.id }, { onSuccess: onClose })}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
