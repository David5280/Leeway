// Connected banks: status, fixing a login, syncing now, and removing.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../api/hooks'
import { BankButton, BankKeysMissing } from '../../components/BankButton'
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
