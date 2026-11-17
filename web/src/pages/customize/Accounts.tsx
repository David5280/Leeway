// The owner's accounts: rename, hide, and add or delete ones kept by hand.

import { useState, type FormEvent } from 'react'
import type { Account, Input } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { ErrorNote, Icon, Switch } from '../../components/ui'
import { useApp } from '../../lib/app'
import { parseMoney } from '../../lib/format'
import { Section } from './Section'

const ACCOUNT_TYPES = [
  ['depository', 'Checking or savings'],
  ['credit', 'Credit card'],
  ['loan', 'Loan'],
  ['investment', 'Investment'],
  ['property', 'Property'],
  ['other', 'Other'],
] as const

export function AccountSection() {
  const accounts = useAction('list_accounts', { includeHidden: true })
  const [adding, setAdding] = useState(false)
  return (
    <Section id="accounts" title="Accounts" hint="Hidden accounts stay out of every total">
      {accounts.data?.length === 0 && (
        <p className="empty small">No accounts yet. Connect a bank below or add one by hand.</p>
      )}
      {accounts.data?.map((account) => (
        <AccountRow key={account.id} account={account} />
      ))}
      <ErrorNote error={accounts.error} />
      {adding ? (
        <AddAccount onDone={() => setAdding(false)} />
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Add an account by hand
          </button>
        </div>
      )}
    </Section>
  )
}

function AccountRow({ account }: { account: Account }) {
  const { exact } = useApp()
  const [name, setName] = useState(account.name)
  const update = useActionMutation('update_account')
  const remove = useActionMutation('delete_account')
  const owed = account.type === 'credit' || account.type === 'loan'
  return (
    <div className="list-row wrap">
      <Switch
        label={`Count ${account.name}`}
        checked={!account.hidden}
        onChange={(shown) => update.mutate({ id: account.id, hidden: !shown })}
      />
      <span className="grow stack-sm" style={{ gap: 0, minWidth: 180 }}>
        <input
          className="input"
          aria-label={`Name for ${account.bankName}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim()
            // Clearing the name goes back to what the bank calls the account.
            setName(next || account.bankName)
            if (next !== account.name) update.mutate({ id: account.id, displayName: next || null })
          }}
        />
        <span className="small muted">
          {account.manual
            ? 'Added by hand'
            : `${account.institutionName ?? 'Bank'}${account.mask ? ` ending ${account.mask}` : ''}`}
        </span>
      </span>
      <span className="num" style={{ textAlign: 'right' }}>
        {account.balanceCents === null
          ? ''
          : `${exact(account.balanceCents)}${owed ? ' owed' : ''}`}
      </span>
      {account.manual && (
        <button
          type="button"
          className="iconbtn"
          aria-label={`Delete ${account.name}`}
          onClick={() => remove.mutate({ id: account.id })}
        >
          <Icon name="close" size={16} />
        </button>
      )}
      <ErrorNote error={update.error ?? remove.error} />
    </div>
  )
}

function AddAccount({ onDone }: { onDone: () => void }) {
  const { settings } = useApp()
  const create = useActionMutation('create_account')
  const [name, setName] = useState('')
  const [type, setType] = useState<Input<'create_account'>['type']>('depository')
  const [balance, setBalance] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate(
      { name, type, balanceCents: parseMoney(balance) ?? 0, currency: settings.currency },
      { onSuccess: onDone },
    )
  }
  return (
    <form className="card soft stack-sm" onSubmit={submit} aria-label="New account">
      <div className="row wrap">
        <input
          className="input grow"
          placeholder="Name, like Cash or Car loan"
          aria-label="Account name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Account type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          {ACCOUNT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="input num"
          style={{ width: 130 }}
          inputMode="decimal"
          placeholder={type === 'credit' || type === 'loan' ? 'Owed' : 'Balance'}
          aria-label="Balance"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
        />
      </div>
      <ErrorNote error={create.error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={create.isPending}>
          Add account
        </button>
      </div>
    </form>
  )
}
