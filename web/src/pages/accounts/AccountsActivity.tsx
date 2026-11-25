// What the accounts picked on Compare accounts did together: a summary in
// words, money in and out, spending and recent activity. The pick is saved in
// settings, so it is the same on every device; none picked means every
// account.

import { useAction } from '../../api/hooks'
import { SectionHead } from '../../components/design/SectionHead'
import { LoadingOrError } from '../../components/ui'
import { activePick } from '../../lib/accounts'
import { useApp } from '../../lib/app'
import { SummaryCard, ViewParts } from './ViewParts'

/** The heading over the activity: which accounts it adds up. */
function pickHeading(count: number): string {
  if (count === 0) return 'All accounts'
  return `${count} picked ${count === 1 ? 'account' : 'accounts'}`
}

/** Money in and out, spending and recent activity for the picked accounts, or for every one. */
export function AccountsActivity() {
  const { settings } = useApp()
  const accounts = useAction('list_accounts')
  const all = accounts.data ?? []
  const picked = activePick(settings.accountSelection, all)
  const view = useAction(
    'summarize_accounts',
    { accountIds: picked },
    // Keep the last view on screen while a new pick loads, so it does not flash.
    { enabled: accounts.isSuccess, placeholderData: (previous) => previous },
  )
  // Nothing to add up until accounts arrive; the page above shows their loading and errors.
  if (all.length === 0) return null
  return (
    <section className="stack" aria-label="Activity on these accounts">
      <SectionHead icon="activity" title={pickHeading(picked.length)} />
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
