// Before Plaid's window opens: the banks already connected, each one a tap
// from being reconnected, so a bank is not linked a second time by mistake.
// The screens it opens on say why just above it (TRIAL_LIMIT_NOTE).

import type { Connection } from '../../api/client'
import { bankName, connectionHealth, needsLogin } from './linking'
import { ReconnectButton } from './ReconnectButton'
import { StepPanel } from './StepPanel'

export function AlreadyConnected({
  connections,
  starting,
  onAddAnother,
  onReconnected,
  onCancel,
}: {
  connections: Connection[]
  /** Plaid's window is on its way, after Add a different bank. */
  starting: boolean
  onAddAnother: () => void
  onReconnected: () => void
  onCancel: () => void
}) {
  return (
    <StepPanel title="Already connected">
      <p className="small muted">
        Is it one of these? Reconnect it to sign in again or add accounts, and keep its history.
      </p>
      <div>
        {connections.map((connection) => (
          <div key={connection.id} className="list-row wrap">
            <span className="grow bank-name">
              <strong>{bankName(connection)}</strong>
              <br />
              <span className={`small ${connection.status === 'active' ? 'muted' : 'warn'}`}>
                {connectionHealth(connection)}
              </span>
            </span>
            {needsLogin(connection) ? (
              <ReconnectButton
                connectionId={connection.id}
                label="Fix login"
                onDone={onReconnected}
              />
            ) : (
              <ReconnectButton connectionId={connection.id} chooseAccounts onDone={onReconnected} />
            )}
          </div>
        ))}
      </div>
      <div className="row wrap">
        <button type="button" className="btn primary" disabled={starting} onClick={onAddAnother}>
          Add a different bank
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </StepPanel>
  )
}
