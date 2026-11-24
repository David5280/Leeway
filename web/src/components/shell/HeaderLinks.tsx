// The round links in the phone's header, and at the foot of the sidebar:
// Chat (only when the server has an AI key), the Inbox bell and Settings.

import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useChatAvailable } from '../../api/chat'
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

/** The phone's header links: Chat when it is on, the Inbox bell, then Settings. */
export function HeaderLinks() {
  const chat = useChatAvailable()
  return (
    <nav aria-label="More" className="row header-links">
      {chat && <RoundLink to={paths.chat()} label="Chat" icon="chat" />}
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

/** The sidebar's foot: Chat when it is on, the Inbox with its unread count, then Settings. */
export function SidebarFoot() {
  const chat = useChatAvailable()
  const unread = useUnread()
  return (
    <nav aria-label="More" className="side-foot">
      {chat && <SideLink to={paths.chat()} label="Chat" icon="chat" />}
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
