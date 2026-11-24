// The round links in the phone's header, and at the foot of the sidebar: the
// Inbox bell and Settings. Chat has no link here: Ask Leeway is on every
// screen instead (ask/AskDock.tsx).

import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { paths } from '../../routes'
import { Bell, inboxLabel, UnreadBadge, useUnread } from '../Bell'
import { Icon, type IconName } from '../ui'

/** A round icon link for the header, lit while its page is open. */
function RoundLink({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => (isActive ? 'bell active' : 'bell')}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={20} />
    </NavLink>
  )
}

/** The phone's header links: the Inbox bell, then Settings. */
export function HeaderLinks() {
  return (
    <nav aria-label="More" className="row header-links">
      <Bell />
      <RoundLink to={paths.settings()} label="Settings" icon="gear" />
    </nav>
  )
}

interface SideLinkProps {
  to: string
  label: string
  icon: IconName
  /** An unread count on the icon, and the fuller name it gives the link. */
  badge?: { dot: ReactNode; label: string }
}

/** A sidebar row with its icon and name, lit while its page is open. */
function SideLink({ to, label, icon, badge }: SideLinkProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => (isActive ? 'side-link active' : 'side-link')}
      aria-label={badge?.label}
    >
      <span className="side-icon">
        <Icon name={icon} size={20} />
        {badge?.dot}
      </span>
      <span className="side-label">{label}</span>
    </NavLink>
  )
}

/** The sidebar's foot: the Inbox with its unread count, then Settings. */
export function SidebarFoot() {
  const unread = useUnread()
  return (
    <nav aria-label="More" className="side-foot">
      <SideLink
        to={paths.inbox()}
        label="Inbox"
        icon="bell"
        badge={{ dot: <UnreadBadge unread={unread} />, label: inboxLabel(unread) }}
      />
      <SideLink to={paths.settings()} label="Settings" icon="gear" />
    </nav>
  )
}
