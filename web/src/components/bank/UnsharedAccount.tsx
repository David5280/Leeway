// An account the bank no longer shares, because the owner un-ticked it when
// reconnecting. Its history stays until the owner says otherwise, so this
// shows what it is and when it was last read, and offers the two ways on:
// share it again (a reconnect) or remove it and its history, after a confirm.

import { useState } from 'react'
import type { Account } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { isOwed, unsharedLabel } from '../../lib/accounts'
import { calendarDate } from '../../lib/format'
import { Money } from '../design/Money'
import { ErrorNote } from '../ui'
import { ReconnectButton } from './ReconnectButton'

export function UnsharedAccount({ account }: { account: Account }) {
  const [confirming, setConfirming] = useState(false)
  const remove = useActionMutation('delete_account')
  // A bank account always has a read time; the unshared time is the fallback.
  const lastRead = account.balanceUpdatedAt ?? account.unsharedAt!
  return (
    <div className="list-row wrap" role="group" aria-label={account.name}>
      <span className="grow bank-name">
        <strong>{account.name}</strong>
        {account.mask && <span className="num muted"> ··{account.mask}</span>}
        <br />
        <span className="small warn">{unsharedLabel(account)}</span>
        <br />
        <span className="small muted">
          Last updated {calendarDate(lastRead)}
          {account.balanceCents !== null && (
            <>
              , {isOwed(account) ? 'owing' : 'holding'}{' '}
              <Money cents={account.balanceCents} precision="cents" />
            </>
          )}
        </span>
      </span>
      {confirming ? (
        <span className="stack-sm unshared-confirm">
          <span className="small">
            This deletes {account.name} and all its transactions from Leeway. It cannot be undone.
          </span>
          <span className="row wrap">
            <button
              type="button"
              className="btn danger small"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: account.id })}
            >
              Remove for good
            </button>
            <button type="button" className="btn ghost small" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </span>
        </span>
      ) : (
        <>
          {/* Update mode with account selection, so the owner can tick it again. */}
          <ReconnectButton
            connectionId={account.connectionId!}
            chooseAccounts
            label="Share it again"
          />
          <button type="button" className="linkbtn small tap" onClick={() => setConfirming(true)}>
            Remove this account and its history
          </button>
        </>
      )}
      <ErrorNote error={remove.error} />
    </div>
  )
}
