import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { auth, call, type Account, type Input } from '../api/client'
import { useAction, useActionMutation } from '../api/hooks'
import { BankButton, BankKeysMissing } from '../components/BankButton'
import { ErrorNote, Icon, Switch } from '../components/ui'
import { useApp } from '../lib/app'
import { parseMoney, timeAgo } from '../lib/format'
import { Section } from './Customize'

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

export function BanksSection() {
  const { status } = useApp()
  const connections = useAction('list_connections', undefined, { enabled: status.bank !== null })
  const sync = useActionMutation('sync_banks')
  const remove = useActionMutation('remove_connection')
  const [removing, setRemoving] = useState<string | null>(null)

  if (!status.bank) {
    return (
      <Section id="banks" title="Banks">
        <BankKeysMissing />
      </Section>
    )
  }
  return (
    <Section id="banks" title="Banks" hint="Read-only: Leeway never moves money">
      {connections.data?.map((c) => (
        <div key={c.id} className="list-row wrap">
          <span className="grow">
            <strong>{c.institutionName ?? 'Bank'}</strong>
            <br />
            <span className="small muted">
              {c.accountCount} {c.accountCount === 1 ? 'account' : 'accounts'}, synced{' '}
              {timeAgo(c.lastSyncedAt)}
            </span>
          </span>
          {c.status === 'active' ? (
            <span className="small good">Connected</span>
          ) : (
            <span className="small warn">
              {c.status === 'needs_reauth'
                ? 'Needs you to sign in again'
                : (c.lastError ?? 'Sync failed')}
            </span>
          )}
          {c.status === 'needs_reauth' && (
            <BankButton connectionId={c.id} label="Fix login" className="btn small" />
          )}
          {removing === c.id ? (
            <>
              <button
                type="button"
                className="btn danger small"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: c.id }, { onSuccess: () => setRemoving(null) })}
              >
                Remove and delete its data
              </button>
              <button type="button" className="btn ghost small" onClick={() => setRemoving(null)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="linkbtn small" onClick={() => setRemoving(c.id)}>
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="row wrap">
        <BankButton label={connections.data?.length ? 'Connect another bank' : 'Connect a bank'} />
        {Boolean(connections.data?.length) && (
          <button
            type="button"
            className="btn"
            disabled={sync.isPending}
            onClick={() => sync.mutate({})}
          >
            <Icon name="sync" size={16} /> {sync.isPending ? 'Syncing' : 'Sync now'}
          </button>
        )}
      </div>
      {sync.data && (
        <p className="small muted">
          {sync.data.reduce((n, r) => n + r.added, 0)} new,{' '}
          {sync.data.reduce((n, r) => n + r.modified, 0)} updated.
        </p>
      )}
      <ErrorNote error={connections.error ?? sync.error ?? remove.error} />
    </Section>
  )
}

export function AgentSection() {
  const { status } = useApp()
  const tokens = useAction('list_tokens')
  const create = useActionMutation('create_token')
  const remove = useActionMutation('delete_token')
  const [name, setName] = useState('AI assistant')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const address = `${status.publicUrl ?? window.location.origin}/mcp`

  return (
    <Section
      id="agent"
      title="AI assistant"
      hint="Connect Claude or another assistant over MCP so it can check in and coach you"
    >
      <span className="small">
        Add this address as a connector, with a key from below as the bearer token:
      </span>
      <code className="code">{address}</code>
      {tokens.data?.map((t) => (
        <div key={t.id} className="list-row">
          <span className="grow">
            {t.name}
            <br />
            <span className="small muted">
              {t.scope === 'read' ? 'Can look' : 'Can look and change'}, last used{' '}
              {timeAgo(t.lastUsedAt)}
            </span>
          </span>
          <button
            type="button"
            className="linkbtn small"
            onClick={() => remove.mutate({ id: t.id })}
          >
            Revoke
          </button>
        </div>
      ))}
      {create.data && (
        <div className="notice stack-sm">
          <span>Your new key, shown only once. Copy it now:</span>
          <code className="code">{create.data.token}</code>
        </div>
      )}
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate({ name, scope })
        }}
      >
        <input
          className="input"
          style={{ width: 200 }}
          aria-label="Key name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="What the key can do"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'read' | 'write')}
        >
          <option value="read">Can look (read-only)</option>
          <option value="write">Can look and change budgets</option>
        </select>
        <button type="submit" className="btn" disabled={create.isPending}>
          Create a key
        </button>
      </form>
      <span className="small muted">Neither kind of key can ever move money.</span>
      <ErrorNote error={tokens.error ?? create.error ?? remove.error} />
    </Section>
  )
}

export function BackupSection() {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const client = useQueryClient()

  async function download() {
    setError(null)
    try {
      const config = await call('export_config')
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'leeway.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(caught)
    }
  }

  async function upload(file: File) {
    setError(null)
    setMessage(null)
    try {
      const config = JSON.parse(await file.text()) as Input<'import_config'>['config']
      const result = await call('import_config', { config, mode })
      await client.invalidateQueries({ queryKey: ['action'] })
      setMessage(`Added ${result.categoriesAdded} categories and ${result.rulesAdded} rules.`)
    } catch (caught) {
      setError(caught instanceof SyntaxError ? new Error('That file is not valid JSON.') : caught)
    }
  }

  return (
    <Section
      id="backup"
      title="Backup"
      hint="Settings, categories and rules as one file. Bank data is never included."
    >
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => void download()}>
          Export leeway.json
        </button>
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Import mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}
        >
          <option value="merge">Import and keep what I have</option>
          <option value="replace">Import and replace my categories and rules</option>
        </select>
        <label className="btn">
          Choose a file
          <input
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {message && <p className="notice">{message}</p>}
      <ErrorNote error={error} />
    </Section>
  )
}

export function SignInSection() {
  const client = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function change(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setDone(false)
    try {
      await auth.changePassword({ currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setDone(true)
    } catch (caught) {
      setError(caught)
    }
  }

  async function signOut() {
    await auth.logout()
    client.clear()
    await client.invalidateQueries()
  }

  return (
    <Section id="account" title="Sign-in">
      <form className="row wrap" onSubmit={change} aria-label="Change password">
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          aria-label="Current password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="New password, 10 or more characters"
          aria-label="New password"
          minLength={10}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button type="submit" className="btn">
          Change password
        </button>
      </form>
      {done && <p className="small good">Password changed. Other devices are signed out.</p>}
      <ErrorNote error={error} />
      <div>
        <button type="button" className="btn ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </Section>
  )
}
