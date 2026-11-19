// Connected banks: status, reconnecting or fixing a login, syncing now, and removing.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../api/hooks'
import { AddBank } from '../../components/bank/AddBank'
import {
  bankName,
  connectionHealth,
  needsLogin,
  TRIAL_LIMIT_NOTE,
} from '../../components/bank/linking'
import { ReconnectButton } from '../../components/bank/ReconnectButton'
import { BankKeysMissing, SandboxNote } from '../../components/PlaidHelp'
import { ErrorNote, Icon } from '../../components/ui'
import { useApp } from '../../lib/app'
import { timeAgo } from '../../lib/format'
import { Section } from './Section'

export function BanksSection() {
  const { status } = useApp()
  const connections = useAction('list_connections', undefined, { enabled: status.bank !== null })
  const sync = useActionMutation('sync_banks')
  const remove = useActionMutation('remove_connection')
  const [removing, setRemoving] = useState<string | null>(null)
  const hasBanks = Boolean(connections.data?.length)

  if (!status.bank) {
    return (
      <Section id="banks" title="Banks">
        <BankKeysMissing platform={status.platform} />
      </Section>
    )
  }
  return (
    <Section id="banks" title="Banks">
      {connections.data?.map((c) => (
        <div key={c.id} className="list-row wrap">
          <span className="grow bank-name">
            <strong>{bankName(c)}</strong>
            <br />
            <span className="small muted">
              {c.accountCount} {c.accountCount === 1 ? 'account' : 'accounts'}, synced{' '}
              {timeAgo(c.lastSyncedAt)}
            </span>
            <br />
            <span className={`small ${c.status === 'active' ? 'good' : 'warn'}`}>
              {connectionHealth(c)}
            </span>
          </span>
          {/* Update mode keeps the same Plaid login, so this never uses another of its places. */}
          {needsLogin(c) ? (
            <ReconnectButton connectionId={c.id} label="Fix login" />
          ) : (
            <ReconnectButton connectionId={c.id} chooseAccounts />
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
      {hasBanks && <p className="small muted">{TRIAL_LIMIT_NOTE}</p>}
      {status.bank.environment === 'sandbox' && <SandboxNote />}
      {/* Wait for the list: adding a bank first shows the ones already connected. */}
      {connections.data && (
        <AddBank
          connections={connections.data}
          className="btn primary"
          beside={
            hasBanks && (
              <button
                type="button"
                className="btn"
                disabled={sync.isPending}
                onClick={() => sync.mutate({})}
              >
                <Icon name="sync" size={16} /> {sync.isPending ? 'Syncing' : 'Sync now'}
              </button>
            )
          }
        />
      )}
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
