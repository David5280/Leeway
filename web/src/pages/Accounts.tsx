// The Accounts dashboard: pick one account or several and see them on their
// own. One account picked is that account's page, so every link to an
// account opens here with just it picked (?select=id).

import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Account, AccountsView } from '../api/client'
import { useAction } from '../api/hooks'
import { useUpdateSettings } from '../api/settings'
import { AlertRows } from '../components/AccountAlerts'
import { Shell } from '../components/Shell'
import { TransactionLine } from '../components/TransactionLine'
import { Card, ErrorNote, LoadingOrError } from '../components/ui'
import { activePick } from '../lib/accounts'
import { useApp } from '../lib/app'
import { settingsPath } from './settings/paths'
import { AccountPicker } from './accounts/AccountPicker'
import { Balances } from './accounts/Balances'
import { Flows } from './accounts/Flows'
import { Spending } from './accounts/Spending'

/**
 * The pick to show: an account linked to from elsewhere, or else the saved
 * pick. A link's pick is saved too, and the address cleared, so a reload or
 * the phone shows the same.
 */
function usePick(): [string[], (next: string[]) => void, Error | null] {
  const { settings } = useApp()
  const update = useUpdateSettings()
  const save = update.mutate
  const [params, setParams] = useSearchParams()
  const linked = params.get('select')
  useEffect(() => {
    if (!linked) return
    save({ accountSelection: [linked] })
    setParams({}, { replace: true })
  }, [linked, save, setParams])
  const picked = linked ? [linked] : settings.accountSelection
  return [picked, (next) => save({ accountSelection: next }), update.error]
}

export function Accounts() {
  const [saved, setPick, saveError] = usePick()
  const accounts = useAction('list_accounts')
  // Only accounts that still exist; none of them means every account.
  const picked = activePick(saved, accounts.data ?? [])
  const view = useAction(
    'summarize_accounts',
    { accountIds: picked },
    {
      enabled: accounts.isSuccess,
      // Keep the last view on screen while a new pick loads, so it does not flash.
      placeholderData: (previous) => previous,
    },
  )

  return (
    <Shell>
      <h1>Accounts</h1>
      {accounts.data && accounts.data.length > 0 && (
        <AccountPicker accounts={accounts.data} picked={picked} onChange={setPick} />
      )}
      <ErrorNote error={saveError} />
      {view.data ? (
        <AccountsBody view={view.data} />
      ) : (
        <LoadingOrError error={accounts.error ?? view.error} />
      )}
    </Shell>
  )
}

function AccountsBody({ view }: { view: AccountsView }) {
  if (view.accounts.length === 0) {
    return (
      <p className="empty">
        No accounts yet. <Link to={settingsPath('banks')}>Connect a bank</Link> or{' '}
        <Link to={settingsPath('accounts')}>add one by hand</Link>.
      </p>
    )
  }
  return (
    <>
      {view.alerts.length > 0 && (
        <Card
          label="Alerts for these accounts"
          className={`tight ${view.alerts.some((a) => a.severity === 'urgent') ? 'over-card' : 'warn-card'}`}
        >
          <AlertRows alerts={view.alerts} />
        </Card>
      )}
      <Card label="Summary" className="summary stack-sm">
        <p className="eyebrow">Summary</p>
        <p className="summary-headline">{view.summary.headline}</p>
        {view.summary.points.length > 0 && (
          <ul className="summary-points">
            {view.summary.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
      </Card>
      <Balances view={view} />
      <div className="grid">
        <Flows flows={view.flows} />
        <Spending spending={view.spending} period={view.period} />
      </div>
      <Recent view={view} />
    </>
  )
}

/** The newest transactions on the picked accounts, linking to all of one account's. */
function Recent({ view }: { view: AccountsView }) {
  const categories = useAction('list_categories')
  // Transfers are left out, so the line reads them as transfers, as on the dashboard.
  const byId = new Map(
    (categories.data ?? []).filter((c) => c.kind !== 'transfer').map((c) => [c.id, c]),
  )
  const only: Account | undefined = view.accounts.length === 1 ? view.accounts[0] : undefined
  return (
    <Card label="Recent transactions" className="stack-sm">
      <div className="row-between">
        <h2>Recent</h2>
        <Link to={only ? `/transactions?account=${only.id}` : '/transactions'} className="linkbtn">
          All transactions
        </Link>
      </div>
      {view.recent.length === 0 && <p className="empty">No transactions yet.</p>}
      {view.recent.map((tx) => (
        <TransactionLine
          key={tx.id}
          tx={tx}
          category={tx.categoryId ? byId.get(tx.categoryId) : undefined}
        />
      ))}
    </Card>
  )
}
