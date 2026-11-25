// The accounts on the Wealth tab: every account as a card, grouped by kind,
// and apart from them any the bank no longer shares, which stay out of every
// total. A card opens its account's own page (AccountDetail), where its alerts
// live. Compare, in the heading, opens a page to add up a few accounts, and
// a row under the cards opens what the owner enters by hand. Net worth leads
// the tab, so it is not repeated.

import { Link } from 'react-router-dom'
import type { Account } from '../../api/client'
import { useAction } from '../../api/hooks'
import { UnsharedAccount } from '../../components/bank/UnsharedAccount'
import { Card } from '../../components/design/Card'
import { SectionHead } from '../../components/design/SectionHead'
import { LinkRows, type LinkRow } from '../../components/LinkRows'
import { Icon, LoadingOrError } from '../../components/ui'
import { isShared } from '../../lib/accounts'
import { paths } from '../../routes'
import { settingsPath } from '../settings/paths'
import { AccountGroups } from './AccountGroups'

/** Every account, grouped by kind, then the way to what is entered by hand. */
export function AccountsSection() {
  const accounts = useAction('list_accounts')
  // The lines and goals are niceties: the cards show without them.
  const balances = useAction('list_recent_balances')
  const goals = useAction('list_goals')

  const all = accounts.data ?? []
  // Only accounts the bank still shares are cards to open or compare; the rest show apart.
  const shared = all.filter(isShared)
  const unshared = all.filter((account) => !isShared(account))
  const lines = new Map(balances.data?.map((one) => [one.accountId, one.balancesCents]))

  return (
    <section className="stack" aria-label="Accounts">
      <div className="page-head">
        <h2 className="page-title">
          <Icon name="accounts" size={22} />
          Accounts
        </h2>
        {/* Comparing needs two accounts to add up. */}
        {shared.length > 1 && (
          <Link to={paths.compareAccounts()} className="btn">
            Compare
          </Link>
        )}
      </div>
      {!accounts.data && <LoadingOrError error={accounts.error} />}
      {accounts.data && all.length === 0 && <NoAccounts />}
      <AccountGroups accounts={shared} balances={lines} goals={goals.data ?? []} picking={null} />
      <NoLongerShared accounts={unshared} />
      {accounts.data && <LinkRows label="Entered by hand" rows={[OWNED_ROW]} />}
    </section>
  )
}

/** The row to things the bank does not show, which count in net worth all the same. */
const OWNED_ROW: LinkRow = {
  to: paths.owned(),
  label: 'Things you own and owe',
  icon: 'wallet',
  detail: "A home, a car or a loan your bank doesn't show",
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
