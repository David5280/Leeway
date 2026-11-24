// The five tabs as links, for the phone's tab bar and the computer's sidebar.
// A tab stays lit on its deeper pages (tabFor), and the lit one is marked as
// the current page for screen readers.

import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../ui'
import { TABS, tabFor } from './tabs'

/** The five tab links, each with its icon and name; `className` styles them for their bar. */
export function TabLinks({ className }: { className: string }) {
  const { pathname } = useLocation()
  const current = tabFor(pathname)
  return TABS.map((tab) => {
    const active = tab === current
    return (
      <Link
        key={tab.to}
        to={tab.to}
        className={active ? `${className} active` : className}
        aria-current={active ? 'page' : undefined}
      >
        <Icon name={tab.icon} size={22} />
        <span>{tab.label}</span>
      </Link>
    )
  })
}
