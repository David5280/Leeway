// Step 3: connecting banks, which can be skipped.

import type { Status } from '../../api/client'
import { useAction } from '../../api/hooks'
import { BankButton, BankKeysMissing } from '../../components/BankButton'
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
    <Frame step={3}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          onNext()
        }}
      >
        <h1>Connect your banks</h1>
        {status.bank ? (
          <>
            <p className="muted">
              Plaid opens a secure window from your bank. Leeway only reads balances and
              transactions, and stores the access key encrypted.
            </p>
            {linked.map((c) => (
              <div key={c.id} className="list-row">
                <span className="grow">
                  <strong>{c.institutionName ?? 'Bank'}</strong>
                  <br />
                  <span className="small muted">
                    {c.accountCount} {c.accountCount === 1 ? 'account' : 'accounts'}
                  </span>
                </span>
                <span className="good small">Connected</span>
              </div>
            ))}
            <div>
              <BankButton
                label={linked.length ? 'Connect another bank' : 'Connect a bank'}
                className={linked.length ? 'btn' : 'btn primary'}
              />
            </div>
          </>
        ) : (
          <BankKeysMissing />
        )}
        <Nav onBack={onBack} next={linked.length ? 'Continue' : 'Skip for now'} />
      </form>
    </Frame>
  )
}
