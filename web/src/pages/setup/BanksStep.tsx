// Step 4: bank sync through Plaid, which is optional and can be skipped.

import type { Status } from '../../api/client'
import { useAction } from '../../api/hooks'
import { AddBank } from '../../components/bank/AddBank'
import { bankName, TRIAL_LIMIT_NOTE } from '../../components/bank/linking'
import { BankKeysMissing, SandboxNote, WHAT_IS_PLAID } from '../../components/PlaidHelp'
import { Frame, Nav } from './Frame'

export function BanksStep({
  status,
  onBack,
  onNext,
}: {
  status: Status
  onBack: () => void
  onNext: () => void
}) {
  const connections = useAction('list_connections', undefined, { enabled: status.bank !== null })
  const linked = connections.data ?? []
  return (
    <Frame step={4}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          onNext()
        }}
      >
        <h1>Sync your bank</h1>
        <p className="muted">
          Optional. With bank sync, your transactions arrive on their own. Without it, you import a
          CSV file from your bank or type them in; the last step shows you how.
        </p>
        {status.bank ? (
          <>
            <p className="small muted">
              {WHAT_IS_PLAID} Your bank opens in Plaid&apos;s secure window, and the key it hands
              back is stored encrypted.
            </p>
            {status.bank.environment === 'sandbox' && <SandboxNote />}
            {linked.map((c) => (
              <div key={c.id} className="list-row">
                <span className="grow bank-name">
                  <strong>{bankName(c)}</strong>
                  <br />
                  <span className="small muted">
                    {c.accountCount} {c.accountCount === 1 ? 'account' : 'accounts'}
                  </span>
                </span>
                <span className="good small">Connected</span>
              </div>
            ))}
            {linked.length > 0 && <p className="small muted">{TRIAL_LIMIT_NOTE}</p>}
            {/* Wait for the list: adding a bank first shows the ones already connected. */}
            {connections.data && <AddBank connections={linked} />}
          </>
        ) : (
          <BankKeysMissing platform={status.platform} />
        )}
        <Nav
          onBack={onBack}
          next={linked.length ? 'Continue' : 'Skip for now'}
          quiet={status.bank !== null && linked.length === 0}
        />
      </form>
    </Frame>
  )
}
