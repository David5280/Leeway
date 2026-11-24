// The bell in the header: the way to the inbox, with how much is unread.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { paths } from '../routes'
import { Icon } from './ui'

/** How often an open tab checks for news. The server's own check runs every few minutes. */
export const BELL_POLL_MS = 60_000

/** The count as the badge shows it: up to 9, then "9+". */
export function badgeText(unread: number): string {
  return unread > 9 ? '9+' : String(unread)
}

/** The bell's cached count, as useAction keys it. */
const BELL_KEY = ['action', 'count_notifications', {}]

/**
 * Puts a fresher unread count on the bell, such as the inbox's own when it
 * has just brought itself up to date, so the two never disagree.
 */
export function useBellCount(unread: number | undefined) {
  const client = useQueryClient()
  useEffect(() => {
    if (unread !== undefined) client.setQueryData(BELL_KEY, { unread })
  }, [client, unread])
}

/** How many notifications are unread, checked again every minute while the app is open. */
export function useUnread(): number {
  const count = useAction('count_notifications', undefined, { refetchInterval: BELL_POLL_MS })
  return count.data?.unread ?? 0
}

/** The inbox's name for screen readers, with how much is unread. */
export function inboxLabel(unread: number): string {
  return unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'
}

/** The unread count as a small badge, or nothing when all is read. */
export function UnreadBadge({ unread }: { unread: number }) {
  if (unread === 0) return null
  return (
    <span className="bell-badge" aria-hidden="true">
      {badgeText(unread)}
    </span>
  )
}

export function Bell() {
  const unread = useUnread()
  const label = inboxLabel(unread)
  return (
    <NavLink
      to={paths.inbox()}
      className={({ isActive }) => (isActive ? 'bell active' : 'bell')}
      aria-label={label}
      title={label}
    >
      <Icon name="bell" size={20} />
      <UnreadBadge unread={unread} />
    </NavLink>
  )
}
