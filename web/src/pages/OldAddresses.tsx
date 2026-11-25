// The app's old addresses, each sent on to where its screen lives now. Links
// to them live on in emails, the phone widget, stored notifications and
// assistants, so these redirects stay for good. The query and the hash ride
// along, so a filter (?account=), an open form (?bill=) or a section (#region)
// still lands where it pointed.

import { Navigate, useLocation, useParams, useSearchParams, type Params } from 'react-router-dom'
import { paths, planSectionHome, type OLD_ROUTES } from '../routes'

/** The new path for an old address, from the parameters its route matched. */
type NewHome = (params: Readonly<Params>) => string

/** Where each old address goes now, by its name in OLD_ROUTES. */
export const NEW_HOMES: Record<keyof typeof OLD_ROUTES, NewHome> = {
  // Home lists every account, so the old Accounts screen lands there.
  accounts: () => paths.home(),
  wealthAccount: ({ id = '' }) => paths.account(id),
  wealthCompare: () => paths.compareAccounts(),
  transactions: () => paths.activity(),
  importTransactions: () => paths.importTransactions(),
  budgets: () => paths.spending(),
  category: ({ id = '' }) => paths.category(id),
  plan: () => paths.payday(),
  planSection: ({ section }) => planSectionHome(section),
  trip: ({ start = '', end = '' }) => paths.trip(start, end),
  // Settings keeps its own address; only the old Customize name moves.
  customize: ({ group }) => (group ? `/settings/${encodeURIComponent(group)}` : '/settings'),
  alerts: () => paths.inbox(),
}

/** Replaces an old address with its new one, so Back never returns to the old one. */
export function Moved({ to }: { to: NewHome }) {
  const params = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: to(params), search, hash }} replace />
}

/**
 * Old links picked one account on the Accounts screen or Wealth (?select=id).
 * That account has its own page now, so Home and Wealth send such a link
 * there: the address to go to, or null for every other address.
 */
export function useSelectedAccount(): string | null {
  const [params] = useSearchParams()
  const linked = params.get('select')
  return linked ? paths.account(linked) : null
}
