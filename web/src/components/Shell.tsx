// The frame around every screen, in one of three shapes (shell/frame.ts):
//   - a phone: a header (the logo, then Chat, the Inbox bell and Settings)
//     over the page, and the five tabs in a bar along the bottom;
//   - a phone turned sideways: one slim top row with the logo, the five tabs
//     and the header's links, so the little height there is goes to the page;
//   - a computer or a tablet turned sideways: a sidebar on the left with the
//     logo, the five tabs, and Chat, the Inbox and Settings at its foot.
// Keys 1 to 5 switch tabs in every shape. The page carries the place of the
// tab it belongs to (data-place), which colors its card labels, card tints
// and charts (styles/places.css); pages outside the tabs carry none.

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { paths } from '../routes'
import { useFrame } from './shell/frame'
import { HeaderLinks, SidebarFoot } from './shell/HeaderLinks'
import { TabLinks } from './shell/TabLinks'
import { tabFor } from './shell/tabs'
import { useTabKeys } from './shell/useTabKeys'
import { Logo } from './ui'

/** The logo and name, a link home. */
function Brand() {
  return (
    <Link to={paths.home()} className="brand" aria-label="Leeway home">
      <Logo />
      <span className="brand-name">leeway</span>
    </Link>
  )
}

/** The computer's sidebar: the logo, the five tabs, then Chat, the Inbox and Settings. */
function Sidebar() {
  return (
    <header className="sidebar">
      <Brand />
      <nav aria-label="Main" className="side-tabs">
        <TabLinks className="side-link" />
      </nav>
      <SidebarFoot />
    </header>
  )
}

/**
 * The phone's header: the logo, then Chat, the Inbox bell, Settings and the
 * screen's actions. Turned sideways it also holds the five tabs (`tabs`).
 */
function Header({ actions, tabs }: { actions?: ReactNode; tabs?: boolean }) {
  return (
    <header className="topbar">
      <Brand />
      {tabs && (
        <nav aria-label="Main" className="row-tabs">
          <TabLinks className="row-tab" />
        </nav>
      )}
      <div className="row">
        <HeaderLinks />
        {actions}
      </div>
    </header>
  )
}

/**
 * Every screen inside the app's frame. `actions` are the screen's own buttons
 * for the top row (Home's Edit layout); beside a sidebar, which holds the
 * logo and links, that row shows only when there are some.
 */
export function Shell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const frame = useFrame()
  const place = tabFor(useLocation().pathname)?.place
  useTabKeys()
  return (
    <div className={`shell shell-${frame}`}>
      {frame === 'sidebar' && <Sidebar />}
      <div className="page" data-place={place}>
        {frame === 'sidebar' ? (
          actions && <div className="topbar topbar-actions">{actions}</div>
        ) : (
          <Header actions={actions} tabs={frame === 'short'} />
        )}
        {children}
      </div>
      {frame === 'tabbar' && (
        <nav aria-label="Main" className="tabbar">
          <TabLinks className="tab" />
        </nav>
      )}
    </div>
  )
}
