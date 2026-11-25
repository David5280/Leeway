// Home's Accounts card: every account the bank still shares with its
// balance, grouped by kind with each group's total (pages/accounts/
// AccountGroups.tsx). Each row opens the account's own page, and a quiet link
// in the heading opens Compare accounts. Accounts the bank no longer shares
// stay out of every total, so they are only counted here, with the way to
// Settings, where they are kept or removed.

import { Link } from 'react-router-dom'
import type { Account } from '../api/client'
import { useAction } from '../api/hooks'
import { Card } from '../components/design/Card'
import { SectionHead } from '../components/design/SectionHead'
import { LoadingOrError } from '../components/ui'
import { isShared } from '../lib/accounts'
import { AccountGroups } from '../pages/accounts/AccountGroups'
import { settingsPath } from '../pages/settings/paths'
import { paths } from '../routes'

const NAME = 'Accounts'

export function AccountListWidget() {
  const accounts = useAction('list_accounts')
  if (!accounts.data) {
    return (
      <Card static="empty" label={NAME} className="stack-sm">
        <SectionHead icon="accounts" title={NAME} />
        <LoadingOrError error={accounts.error} />
      </Card>
    )
  }
  if (accounts.data.length === 0) return <NoAccounts />
  const shared = accounts.data.filter(isShared)
  return (
    <Card static="list" label={NAME} className="stack home-accounts">
      {/* Comparing needs two accounts to add up. */}
      <SectionHead
        icon="accounts"
        title={NAME}
        aside={shared.length > 1 ? <CompareLink /> : undefined}
      />
      <AccountGroups accounts={shared} />
      <NoLongerShared accounts={accounts.data.filter((account) => !isShared(account))} />
    </Card>
  )
}

/** A small link in the heading that still takes a finger's 44px tap (.tap, styles.css). */
function CompareLink() {
  return (
    <Link to={paths.compareAccounts()} className="linkbtn small tap">
      Compare
    </Link>
  )
}

/** No accounts yet: the two ways to add one. */
function NoAccounts() {
  return (
    <Card static="empty" label={NAME} className="stack-sm">
      <SectionHead icon="accounts" title={NAME} />
      <p className="empty">
        No accounts yet. <Link to={settingsPath('banks')}>Connect a bank</Link> or{' '}
        <Link to={settingsPath('accounts')}>add one by hand</Link>.
      </p>
    </Card>
  )
}

/** How many accounts the bank stopped sharing, kept out of the totals, and where they are kept. */
function NoLongerShared({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) return null
  const count = accounts.length === 1 ? '1 account' : `${accounts.length} accounts`
  return (
    <Link to={settingsPath('accounts')} className="small muted home-accounts-unshared">
      {count} no longer shared by the bank, left out of these totals
    </Link>
  )
}
