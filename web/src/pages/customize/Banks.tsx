// Connected banks: status, fixing a login, syncing now, re-dating older transactions, and removing.

import { useState } from 'react'
import type { Output } from '../../api/client'
import { useAction, useActionMutation } from '../../api/hooks'
import { BankButton } from '../../components/BankButton'
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

  if (!status.bank) {
    return (
      <Section id="banks" title="Banks">
        <BankKeysMissing platform={status.platform} />
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
      {status.bank.environment === 'sandbox' && <SandboxNote />}
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
      {Boolean(connections.data?.length) && <PurchaseDates />}
    </Section>
  )
}

/** What re-dating did, in a sentence: how many dates moved, and any bank that failed. */
function purchaseDatesText(results: Output<'use_purchase_dates'>): string {
  const changed = results.reduce((sum, r) => sum + r.changed, 0)
  const moved =
    changed === 0
      ? 'Every date already shows the day of purchase.'
      : `Moved ${changed.toLocaleString()} ${changed === 1 ? 'date' : 'dates'} to the day of purchase.`
  const failed = results
    .filter((r) => r.error)
    .map((r) => ` ${r.institutionName ?? 'A bank'} could not be reached: ${r.error}`)
  return moved + failed.join('')
}

/**
 * Moves transactions synced before Leeway used purchase dates onto the day
 * of purchase. Only dates change, and running it again changes nothing.
 */
function PurchaseDates() {
  const redate = useActionMutation('use_purchase_dates')
  return (
    <div className="stack-sm">
      <h3>Purchase dates</h3>
      <span className="small muted">
        Transactions synced before Leeway used the day you bought something still show the day it
        posted. This asks your banks for their history again and moves only those dates; your
        categories, notes and hidden transactions stay as they are.
      </span>
      <div>
        <button
          type="button"
          className="btn"
          disabled={redate.isPending}
          onClick={() => redate.mutate({})}
        >
          {redate.isPending ? 'Updating dates' : 'Use purchase dates for older transactions'}
        </button>
      </div>
      {redate.data && (
        <p className="small" role="status">
          {purchaseDatesText(redate.data)}
        </p>
      )}
      <ErrorNote error={redate.error} />
    </div>
  )
}
