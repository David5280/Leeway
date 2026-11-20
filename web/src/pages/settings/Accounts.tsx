// The owner's accounts: rename, hide, set low-balance warnings, and add or
// delete ones kept by hand.

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Account, Input } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { Money } from '../../components/design/Money'
import { UnsharedAccount } from '../../components/bank/UnsharedAccount'
import { ErrorNote, Icon, Switch } from '../../components/ui'
import { ACCOUNT_TYPES, accountPath, isOwed, isShared } from '../../lib/accounts'
import { useApp } from '../../lib/app'
import { parseMoney } from '../../lib/format'
import { LowBalanceField } from './LowBalance'
import { Section } from './Section'

export function AccountSection() {
  const accounts = useAction('list_accounts', { includeHidden: true })
  const [adding, setAdding] = useState(false)
  const shared = accounts.data?.filter(isShared)
  const unshared = accounts.data?.filter((account) => !isShared(account)) ?? []
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
      {shared?.map((account) => (
        <AccountRow key={account.id} account={account} />
      ))}
      {unshared.length > 0 && (
        <section className="stack-sm" aria-label="No longer shared">
          <h3>No longer shared</h3>
          <p className="small muted">
            These were left out when a bank was reconnected. They stay out of every total, and their
            history is kept until you remove them.
          </p>
          {unshared.map((account) => (
            <UnsharedAccount key={account.id} account={account} />
          ))}
        </section>
      )}
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
  // What the owner is typing, held only while they edit and save. Otherwise the
  // field shows the server's name, so a rename made elsewhere (a bank's new name
  // for the account) is never saved back as the owner's own.
  const [draft, setDraft] = useState<string | null>(null)
  const update = useActionMutation('update_account')
  const remove = useActionMutation('delete_account')
  const owed = isOwed(account)
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
          aria-label={`Name for ${account.name}`}
          value={draft ?? account.name}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            // Only typing starts a draft, so a field merely tabbed through saves nothing.
            if (draft === null) return
            const next = draft.trim()
            if (next === account.name) {
              setDraft(null)
              return
            }
            setDraft(next)
            // Cleared, the server names it as Leeway would; the list has the new
            // name before onSuccess, so the draft goes without a flash of the old.
            update.mutate(
              { id: account.id, displayName: next || null },
              { onSuccess: () => setDraft(null) },
            )
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
        {account.balanceCents === null ? (
          'Open'
        ) : (
          <>
            <Money cents={account.balanceCents} precision="cents" />
            {owed ? ' owed' : ''}
          </>
        )}
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
          className="input grow name-field"
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
