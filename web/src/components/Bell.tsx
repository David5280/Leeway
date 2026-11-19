// The bell in the header: the way to the inbox, with how much is unread.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAction } from '../api/hooks'
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

export function Bell() {
  const count = useAction('count_notifications', undefined, { refetchInterval: BELL_POLL_MS })
  const unread = count.data?.unread ?? 0
  const label = unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'
  return (
    <NavLink
      to="/inbox"
      className={({ isActive }) => (isActive ? 'bell active' : 'bell')}
      aria-label={label}
      title={label}
    >
      <Icon name="bell" size={20} />
      {unread > 0 && (
        <span className="bell-badge" aria-hidden="true">
          {badgeText(unread)}
        </span>
      )}
    </NavLink>
  )
}
