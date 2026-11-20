// After Plaid's window closes on a bank that is already connected: keep the
// login Leeway has (Plaid's advice), or, as a deliberate second step, add a
// separate login at the same bank.

import type { DuplicateBankDetails } from './linking'
import { ReconnectButton } from './ReconnectButton'
import { StepPanel } from './StepPanel'

/** The bank was already connected; nothing new has been added or counted yet. */
export function SameBankFound({
  duplicate,
  onKeep,
  onReconnected,
  onDifferentLogin,
}: {
  duplicate: DuplicateBankDetails
  onKeep: () => void
  onReconnected: () => void
  onDifferentLogin: () => void
}) {
  const name = duplicate.institutionName
  const sameAccounts = duplicate.logins.some((login) => login.sameAccounts)
  // A login that stopped syncing is likely why the bank was linked again; fixing it is the better way.
  const broken = duplicate.logins.find((login) => login.status !== 'active')
  return (
    <StepPanel title={`${name} is already connected`}>
      <p className="small">
        {sameAccounts
          ? 'The accounts you picked are already in Leeway, so this looks like the login you have.'
          : 'Leeway already has a login there.'}{' '}
        Keeping it adds nothing new.
      </p>
      <div className="row wrap">
        {broken ? (
          <ReconnectButton
            connectionId={broken.connectionId}
            label="Fix the one I have"
            className="btn primary"
            onDone={onReconnected}
          />
        ) : (
          <button type="button" className="btn primary" onClick={onKeep}>
            Keep the one I have
          </button>
        )}
        <button type="button" className="btn" onClick={onDifferentLogin}>
          It&apos;s a different login
        </button>
        {broken && (
          <button type="button" className="btn ghost" onClick={onKeep}>
            Not now
          </button>
        )}
      </div>
    </StepPanel>
  )
}

/** The deliberate second step before a second login at the same bank. */
export function SecondLogin({
  institutionName,
  saving,
  onConfirm,
  onBack,
}: {
  institutionName: string
  saving: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  return (
    <StepPanel title={`Add a second ${institutionName} login?`}>
      <p className="small">
        Only for a separate login, like a partner&apos;s or a business account. It uses another
        Plaid connection, and on the Trial plan that connection keeps counting even if you remove it
        later.
      </p>
      <div className="row wrap">
        <button type="button" className="btn primary" disabled={saving} onClick={onConfirm}>
          {saving ? 'Pulling in your accounts' : 'Add second login'}
        </button>
        <button type="button" className="btn ghost" disabled={saving} onClick={onBack}>
          Back
        </button>
      </div>
    </StepPanel>
  )
}
