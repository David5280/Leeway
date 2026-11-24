// The accounts on the Wealth tab: any alerts, then every account as a card,
// grouped by kind, and apart from them any the bank no longer shares, which
// stay out of every total. A card opens its account's own page
// (AccountDetail). Select mode turns the cards into tick boxes: the ticked
// accounts are added up in a bar, and the money in and out, spending and
// recent activity (AccountsActivity, further down the tab) follow the pick,
// which is saved in settings. Net worth leads the tab, so it is not repeated.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Account } from '../../api/client'
import { useAction } from '../../api/hooks'
import { useUpdateSettings } from '../../api/settings'
import { AlertsCard } from '../../components/AccountAlerts'
import { UnsharedAccount } from '../../components/bank/UnsharedAccount'
import { Card } from '../../components/design/Card'
import { SectionHead } from '../../components/design/SectionHead'
import { ErrorNote, Icon, LoadingOrError } from '../../components/ui'
import { activePick, isShared } from '../../lib/accounts'
import { useApp } from '../../lib/app'
import { settingsPath } from '../settings/paths'
import { AccountGroups } from './AccountGroups'
import { SelectBar } from './SelectBar'
import { SummaryCard, ViewParts } from './ViewParts'

/** Every account, grouped by kind, with their alerts, and the way to pick some to add up. */
export function AccountsSection() {
  const { settings } = useApp()
  const update = useUpdateSettings()
  const [selecting, setSelecting] = useState(false)
  const accounts = useAction('list_accounts')
  // The lines, goals and history are niceties: the cards show without them.
  const balances = useAction('list_recent_balances')
  const goals = useAction('list_goals')
  const alerts = useAction('list_alerts')

  const all = accounts.data ?? []
  // Only accounts the bank still shares are cards to open or pick; the rest show apart.
  const shared = all.filter(isShared)
  const unshared = all.filter((account) => !isShared(account))
  // Only accounts that still exist; none of them means every account.
  const picked = activePick(settings.accountSelection, all)
  const toggle = (id: string) =>
    update.mutate({
      accountSelection: picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id],
    })
  const lines = new Map(balances.data?.map((one) => [one.accountId, one.balancesCents]))

  return (
    <section className="stack" aria-label="Accounts">
      <div className="page-head">
        <h2 className="page-title">
          <Icon name="accounts" size={22} />
          Accounts
        </h2>
        {shared.length > 1 && !selecting && (
          <button type="button" className="btn" onClick={() => setSelecting(true)}>
            Select
          </button>
        )}
      </div>
      <ErrorNote error={update.error} />
      {accounts.data && all.length === 0 && <NoAccounts />}
      {!accounts.data && <LoadingOrError error={accounts.error} />}
      {all.length > 0 && (
        <>
          {/* While picking, the cards and the bar's total are all there is. */}
          {!selecting && (
            <AlertsCard alerts={alerts.data ?? []} label="Alerts for these accounts" />
          )}
          <AccountGroups
            accounts={shared}
            balances={lines}
            goals={goals.data ?? []}
            picking={selecting ? { picked, toggle } : null}
          />
          {!selecting && <NoLongerShared accounts={unshared} />}
          {selecting && (
            <SelectBar
              picked={shared.filter((account) => picked.includes(account.id))}
              onDone={() => setSelecting(false)}
            />
          )}
        </>
      )}
    </section>
  )
}

function NoAccounts() {
  return (
    <p className="empty">
      No accounts yet. <Link to={settingsPath('banks')}>Connect a bank</Link> or{' '}
      <Link to={settingsPath('accounts')}>add one by hand</Link>.
    </p>
  )
}

/**
 * Accounts the bank no longer shares: left out of every total, since nothing
 * keeps their balances current, with their history kept until removed.
 */
function NoLongerShared({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) return null
  return (
    <Card static="form" label="No longer shared" className="stack-sm">
      <SectionHead icon="accounts" title="No longer shared" />
      <p className="small muted">
        Left out of the balances and alerts, since the bank no longer updates them. Their past
        transactions still count.
      </p>
      {accounts.map((account) => (
        <UnsharedAccount key={account.id} account={account} />
      ))}
    </Card>
  )
}

/** Money in and out, spending and recent activity for the picked accounts, or for every one. */
export function AccountsActivity() {
  const { settings } = useApp()
  const accounts = useAction('list_accounts')
  const all = accounts.data ?? []
  const picked = activePick(settings.accountSelection, all)
  const ready = accounts.isSuccess
  const view = useAction(
    'summarize_accounts',
    { accountIds: picked },
    // Keep the last view on screen while a new pick loads, so it does not flash.
    { enabled: ready, placeholderData: (previous) => previous },
  )
  // Nothing to add up until accounts arrive; AccountsSection shows their loading and errors.
  if (all.length === 0) return null
  const count = picked.length
  return (
    <section className="stack" aria-label="Activity on these accounts">
      <SectionHead
        icon="activity"
        title={
          count === 0 ? 'All accounts' : `${count} picked ${count === 1 ? 'account' : 'accounts'}`
        }
      />
      {view.data ? (
        <>
          <SummaryCard summary={view.data.summary} />
          <ViewParts view={view.data} />
        </>
      ) : (
        <LoadingOrError error={view.error} />
      )}
    </section>
  )
}
