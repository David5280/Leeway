// The Accounts screen: every account as a card, grouped by kind, under what
// they all come to together and any alerts. A card opens its account's own
// page (AccountDetail). Select mode turns the cards into tick boxes: the
// ticked accounts are added up in a bar, and the money in and out, spending
// and recent activity below follow the pick, which is saved in settings.

import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import type { Account, NetWorth } from '../api/client'
import { useAction } from '../api/hooks'
import { useUpdateSettings } from '../api/settings'
import { AlertsCard } from '../components/AccountAlerts'
import { Card } from '../components/design/Card'
import { HeroFigure } from '../components/design/HeroFigure'
import { Money } from '../components/design/Money'
import { SectionHead } from '../components/design/SectionHead'
import { Sparkline } from '../components/design/Sparkline'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, LoadingOrError } from '../components/ui'
import { combine } from '../lib/accountCards'
import { accountDetailPath, activePick } from '../lib/accounts'
import { useApp } from '../lib/app'
import { allAccountsDrill } from '../lib/drills/accounts'
import { settingsPath } from './settings/paths'
import { AccountGroups } from './accounts/AccountGroups'
import { SelectBar } from './accounts/SelectBar'
import { SummaryCard, ViewParts } from './accounts/ViewParts'

export function Accounts() {
  // Old links picked one account here (?select=id); that account has its own page now.
  const [params] = useSearchParams()
  const linked = params.get('select')
  if (linked) return <Navigate to={accountDetailPath(linked)} replace />
  return <AccountsScreen />
}

function AccountsScreen() {
  const { settings } = useApp()
  const update = useUpdateSettings()
  const [selecting, setSelecting] = useState(false)
  const accounts = useAction('list_accounts')
  // The lines, goals and history are niceties: the cards show without them.
  const balances = useAction('list_recent_balances')
  const goals = useAction('list_goals')
  const netWorth = useAction('get_net_worth', { days: 365 })
  const alerts = useAction('list_alerts')

  const all = accounts.data ?? []
  // Only accounts that still exist; none of them means every account.
  const picked = activePick(settings.accountSelection, all)
  const toggle = (id: string) =>
    update.mutate({
      accountSelection: picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id],
    })
  const lines = new Map(balances.data?.map((one) => [one.accountId, one.balancesCents]))

  return (
    <Shell>
      <div className="page-head">
        <h1 className="page-title">
          <Icon name="accounts" size={22} />
          Accounts
        </h1>
        {all.length > 1 && !selecting && (
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
          {!selecting && (
            <AlertsCard alerts={alerts.data ?? []} label="Alerts for these accounts" />
          )}
          {!selecting && <TogetherCard accounts={all} netWorth={netWorth.data} />}
          <AccountGroups
            accounts={all}
            balances={lines}
            goals={goals.data ?? []}
            picking={selecting ? { picked, toggle } : null}
          />
          {selecting && (
            <SelectBar
              picked={all.filter((account) => picked.includes(account.id))}
              onDone={() => setSelecting(false)}
            />
          )}
          <PickedView picked={picked} ready={accounts.isSuccess} />
        </>
      )}
    </Shell>
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

/** What every counted account comes to: owned less owed, with net worth's line. */
function TogetherCard({ accounts, netWorth }: { accounts: Account[]; netWorth?: NetWorth }) {
  const counted = accounts.filter((account) => !account.hidden)
  const { ownedCents, owedCents, netCents } = combine(counted)
  const history = netWorth?.history.map((point) => point.netWorthCents) ?? []
  return (
    <Card
      drill={allAccountsDrill(accounts, netWorth)}
      label="All accounts together"
      className="hero stack"
    >
      <HeroFigure
        label="All accounts together"
        cents={netCents}
        precision="cents"
        tone={netCents < 0 ? 'problem' : undefined}
        caption={
          <>
            <Money cents={ownedCents} /> owned, less <Money cents={owedCents} /> owed
          </>
        }
        aside={
          history.length > 1 ? (
            <Sparkline values={history} area label="Net worth over the last year" />
          ) : undefined
        }
      />
    </Card>
  )
}

/** Money in and out, spending and recent activity for the pick, or for every account. */
function PickedView({ picked, ready }: { picked: string[]; ready: boolean }) {
  const view = useAction(
    'summarize_accounts',
    { accountIds: picked },
    // Keep the last view on screen while a new pick loads, so it does not flash.
    { enabled: ready, placeholderData: (previous) => previous },
  )
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
