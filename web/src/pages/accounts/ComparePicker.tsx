// Compare accounts' body: every shared account as a tick box, grouped by
// kind, with a bar that adds the ticked ones up and opens the math, then what
// the picked accounts did together (AccountsActivity). Each tick is saved in
// settings straight away, so the activity follows it and it is kept for next
// time.

import { Link } from 'react-router-dom'
import { useAction } from '../../api/hooks'
import { useUpdateSettings } from '../../api/settings'
import { ErrorNote, LoadingOrError } from '../../components/ui'
import { activePick, isShared } from '../../lib/accounts'
import { useApp } from '../../lib/app'
import { settingsPath } from '../settings/paths'
import { AccountGroups } from './AccountGroups'
import { AccountsActivity } from './AccountsActivity'
import { SelectBar } from './SelectBar'

export function ComparePicker() {
  const { settings } = useApp()
  const update = useUpdateSettings()
  const accounts = useAction('list_accounts')
  // The lines and goals are niceties: the tick boxes show without them.
  const balances = useAction('list_recent_balances')
  const goals = useAction('list_goals')

  if (!accounts.data) return <LoadingOrError error={accounts.error} />
  // Accounts the bank no longer shares stay out of every total, so out of picking too.
  const shared = accounts.data.filter(isShared)
  if (shared.length < 2) return <NothingToCompare />

  // Only accounts that still exist; none of them means every account.
  const picked = activePick(settings.accountSelection, accounts.data)
  const toggle = (id: string) =>
    update.mutate({
      accountSelection: picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id],
    })
  const lines = new Map(balances.data?.map((one) => [one.accountId, one.balancesCents]))

  return (
    <>
      <section className="stack" aria-label="Pick accounts">
        <p className="muted">
          Pick accounts to see what they come to together, and what went in and out of them.
        </p>
        <ErrorNote error={update.error} />
        <AccountGroups
          accounts={shared}
          balances={lines}
          goals={goals.data ?? []}
          picking={{ picked, toggle }}
        />
        <SelectBar picked={shared.filter((account) => picked.includes(account.id))} />
      </section>
      <AccountsActivity />
    </>
  )
}

/** Fewer than two accounts: nothing to add up, and the way to add another. */
function NothingToCompare() {
  return (
    <p className="empty">
      Comparing needs two or more accounts. <Link to={settingsPath('banks')}>Connect a bank</Link>{' '}
      or <Link to={settingsPath('accounts')}>add one by hand</Link>.
    </p>
  )
}
