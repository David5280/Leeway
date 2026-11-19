// The owner's accounts: rename, hide, set low-balance warnings, and add or
// delete ones kept by hand.

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { accountDisplayName } from '../../../../server/src/domain/accountName'
import type { Account, Input } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { ErrorNote, Icon, Switch } from '../../components/ui'
import { ACCOUNT_TYPES, accountPath, isOwed } from '../../lib/accounts'
import { useApp } from '../../lib/app'
import { parseMoney } from '../../lib/format'
import { LowBalanceField } from './LowBalance'
import { Section } from './Section'

export function AccountSection() {
  const accounts = useAction('list_accounts', { includeHidden: true })
  const [adding, setAdding] = useState(false)
  return (
    <Section
      id="accounts"
      title="Accounts"
      hint="Hidden accounts stay out of every total. Checking and savings accounts warn when they run low: leave the amount empty for the default, or 0 for no warning."
    >
      {accounts.data?.length === 0 && (
        <p className="empty small">
          No accounts yet. Connect a bank under Banks, or add one by hand below.
        </p>
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
  const owed = isOwed(account)
  // What the account is called without the owner's own name, which clearing the field goes back to.
  const defaultName = accountDisplayName({ ...account, nickname: null })
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
          aria-label={`Name for ${defaultName}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim()
            setName(next || defaultName)
            if (next !== account.name) update.mutate({ id: account.id, displayName: next || null })
          }}
        />
        <span className="small muted">
          {account.manual
            ? 'Added by hand'
            : `${account.institutionName ?? 'Bank'}${account.mask ? ` ending ${account.mask}` : ''}`}
        </span>
      </span>
      {account.type === 'depository' && <LowBalanceField account={account} />}
      <Link
        to={accountPath(account.id)}
        className="num linkbtn"
        style={{ textAlign: 'right' }}
        aria-label={`Open ${account.name}`}
      >
        {account.balanceCents === null
          ? 'Open'
          : `${exact(account.balanceCents)}${owed ? ' owed' : ''}`}
      </Link>
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
          placeholder={isOwed({ type }) ? 'Owed' : 'Balance'}
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
