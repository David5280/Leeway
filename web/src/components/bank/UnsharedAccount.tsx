// An account the bank no longer shares, because the owner un-ticked it when
// reconnecting. Its history stays until the owner says otherwise, so this
// shows what it is and when it was last read, and offers the two ways on:
// share it again (a reconnect, where Plaid lets the owner tick it again) or
// remove it and its history, after a confirm. When it may already be back as
// a newer account, its history may be here twice, and it says so.

import { useState } from 'react'
import type { Account } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { useApp } from '../../lib/app'
import { isOwed, unsharedLabel } from '../../lib/accounts'
import { calendarDate } from '../../lib/format'
import { Money } from '../design/Money'
import { ErrorNote } from '../ui'
import { ReconnectButton } from './ReconnectButton'

export function UnsharedAccount({ account }: { account: Account }) {
  const [confirming, setConfirming] = useState(false)
  const remove = useActionMutation('delete_account')
  const canShareAgain = useApp().status.bank?.chooseAccounts === true
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
        {account.mayBeBackAs && (
          <>
            <br />
            <span className="small warn">
              It may be back as {account.mayBeBackAs}, so its transactions may now be here twice. If
              it is, remove this one.
            </span>
          </>
        )}
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
          {canShareAgain && (
            <ReconnectButton
              connectionId={account.connectionId!}
              chooseAccounts
              label="Share it again"
            />
          )}
          <button type="button" className="linkbtn small tap" onClick={() => setConfirming(true)}>
            Remove this account and its history
          </button>
        </>
      )}
      <ErrorNote error={remove.error} />
    </div>
  )
}
