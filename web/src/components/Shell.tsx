// The frame around every screen, in one of three shapes (shell/frame.ts):
//   - a phone: a header (the logo, then Chat, the Inbox bell and Settings)
//     over the page, and the five tabs in a bar along the bottom;
//   - a phone turned sideways: the same header, with the tabs in a slim rail
//     down the left, so the little height there is goes to the page;
//   - a computer or a tablet turned sideways: a sidebar on the left with the
//     logo, the five tabs, and Chat, the Inbox and Settings at its foot.
// Keys 1 to 5 switch tabs in every shape.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { paths } from '../routes'
import { useFrame } from './shell/frame'
import { HeaderLinks, SidebarFoot } from './shell/HeaderLinks'
import { TabLinks } from './shell/TabLinks'
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

/** The phone's header: the logo, then Chat, the Inbox bell, Settings and the screen's actions. */
function Header({ actions }: { actions?: ReactNode }) {
  return (
    <header className="topbar">
      <Brand />
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
  useTabKeys()
  return (
    <div className={`shell shell-${frame}`}>
      {frame === 'sidebar' && <Sidebar />}
      {frame === 'rail' && (
        <nav aria-label="Main" className="rail">
          <TabLinks className="tab" />
        </nav>
      )}
      <div className="page">
        {frame === 'sidebar' ? (
          actions && <div className="topbar topbar-actions">{actions}</div>
        ) : (
          <Header actions={actions} />
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
