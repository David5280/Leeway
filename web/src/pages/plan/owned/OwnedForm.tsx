// The form for something owned or owed by hand: what it is (for a new one),
// its name and amount, a loan's rate and monthly payment, and for a home or
// car the loan against it. Removing one deletes the manual account. What is
// typed is read back by readOwned.ts, which refuses rather than changes it.

import { useState, type FormEvent } from 'react'
import { carriesLoan } from '../../../../../server/src/domain/ownedRules'
import { useAction, useActionMutation } from '../../../api/hooks'
import { ErrorNote, Segmented, Setting } from '../../../components/ui'
import {
  isOwedKind,
  NEW_KINDS,
  ownedText,
  type NewKind,
  type OwnedItem,
  type OwnedText,
} from './ownedText'
import {
  loanChoices,
  readEdit,
  readOwned,
  type LoanChoice,
  type OwnedEdit,
  type OwnedFields,
} from './readOwned'

/** A loan's rate and monthly payment. */
function TermsFields({
  text,
  onChange,
}: {
  text: OwnedText
  onChange: (change: Partial<OwnedText>) => void
}) {
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

/** The loan against a home or car, or None to untie it. */
function LoanField({
  loanId,
  loans,
  onChange,
}: {
  loanId: string
  loans: LoanChoice[]
  onChange: (change: Partial<OwnedText>) => void
}) {
  if (loans.length === 0) return null
  return (
    <Setting label="Loan on it" hint="Optional. Shows what is yours after it">
      <select
        className="input"
        aria-label="Loan on it"
        style={{ width: 'auto' }}
        value={loanId}
        onChange={(e) => onChange({ loanId: e.target.value })}
      >
        <option value="">None</option>
        {loans.map((loan) => (
          <option key={loan.id} value={loan.id}>
            {loan.label}
          </option>
        ))}
      </select>
    </Setting>
  )
}

/**
 * Adding, changing and deleting one, each closing the form once it is done.
 * Each clears the errors the others left, so only the latest try's error
 * shows: a Delete that failed is not still blamed once Save is pressed.
 */
function useOwnedActions(onClose: () => void) {
  const add = useActionMutation('add_owned_or_owed')
  const update = useActionMutation('update_owned_or_owed')
  const remove = useActionMutation('delete_account')
  const close = { onSuccess: onClose }
  const clearErrors = () => [add, update, remove].forEach((mutation) => mutation.reset())
  return {
    add(kind: NewKind, fields: OwnedFields) {
      clearErrors()
      add.mutate({ kind, ...fields }, close)
    },
    update(id: string, edit: OwnedEdit) {
      clearErrors()
      update.mutate({ id, ...edit }, close)
    },
    remove(id: string) {
      clearErrors()
      remove.mutate({ id }, close)
    },
    busy: add.isPending || update.isPending || remove.isPending,
    error: add.error ?? update.error ?? remove.error,
  }
}

/**
 * The form for `item`, or for a new thing without one. `owned` is every thing
 * owned, so a loan already tied to one of the others is not offered.
 */
export function OwnedForm({
  item,
  owned,
  onClose,
}: {
  item?: OwnedItem
  owned: OwnedItem[]
  onClose: () => void
}) {
  const actions = useOwnedActions(onClose)
  const accounts = useAction('list_accounts')
  const [newKind, setNewKind] = useState<NewKind>('home')
  const [text, setText] = useState<OwnedText>(() => ownedText(item))
  const [problem, setProblem] = useState<string | null>(null)
  const kind = item ? item.kind : newKind
  const owed = isOwedKind(kind)
  const change = (next: Partial<OwnedText>) => {
    setProblem(null)
    setText((now) => ({ ...now, ...next }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (item) {
      const read = readEdit(text, item)
      if (read.ok) actions.update(item.id, read.value)
      else setProblem(read.error)
    } else {
      const read = readOwned(text, newKind)
      if (read.ok) actions.add(newKind, read.value)
      else setProblem(read.error)
    }
  }

  return (
    <form
      className="stack"
      onSubmit={submit}
      aria-label={item ? `Edit ${item.name}` : 'Add something'}
      noValidate
    >
      {!item && (
        <Segmented
          label="What is it?"
          value={newKind}
          options={NEW_KINDS}
          onChange={(next) => {
            setProblem(null)
            setNewKind(next)
          }}
        />
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
      {owed && <TermsFields text={text} onChange={change} />}
      {carriesLoan(kind) && (
        <LoanField
          loanId={text.loanId}
          loans={loanChoices(accounts.data ?? [], item, owned)}
          onChange={change}
        />
      )}
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
      <ErrorNote error={actions.error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={actions.busy}>
          {item ? 'Save' : 'Add'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        {item && (
          <button
            type="button"
            className="btn danger"
            disabled={actions.busy}
            onClick={() => actions.remove(item.id)}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
