// Picking the accounts that hold the emergency fund: a tick for each checking
// and savings account. None ticked counts every savings account again.

import { useState, type FormEvent } from 'react'
import { useActionMutation } from '../../../api/hooks'
import { Money } from '../../../components/design/Money'
import { ErrorNote } from '../../../components/ui'
import type { EmergencyView } from './emergencyText'

export function FundAccountsForm({ view, onDone }: { view: EmergencyView; onDone: () => void }) {
  const change = useActionMutation('change_emergency_fund')
  // Starts from what is counted now, so an untouched save changes nothing.
  const [ticked, setTicked] = useState<string[]>(() =>
    view.picked ? view.accounts.filter((a) => a.counted).map((a) => a.id) : [],
  )

  function toggle(id: string) {
    setTicked((now) => (now.includes(id) ? now.filter((one) => one !== id) : [...now, id]))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    change.mutate({ accountIds: ticked }, { onSuccess: onDone })
  }

  if (view.accounts.length === 0) {
    return <p className="small muted">Link or add a savings account to hold the fund.</p>
  }
  return (
    <form className="stack-sm" onSubmit={submit} aria-label="Accounts for the emergency fund">
      <span className="small muted">Leave all unticked to count every savings account.</span>
      {view.accounts.map((account) => (
        <label key={account.id} className="check-row">
          <input
            type="checkbox"
            checked={ticked.includes(account.id)}
            onChange={() => toggle(account.id)}
          />
          <span className="row-between wrap check-words">
            <span>{account.name}</span>
            <Money cents={account.balanceCents} className="small muted" />
          </span>
        </label>
      ))}
      <ErrorNote error={change.error} />
      <div className="row wrap">
        <button type="submit" className="btn primary" disabled={change.isPending}>
          Save
        </button>
      </div>
    </form>
  )
}
