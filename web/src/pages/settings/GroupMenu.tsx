// The Settings menu: a list beside the settings on a wide screen, a row of
// pills that scrolls sideways on a phone. Each item is a link to its group's
// address, so the menu works with the keyboard, Back, and opening in a new tab.

import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { SETTINGS_GROUPS } from './groups'
import { settingsPath } from './paths'

export function GroupMenu({ current }: { current: string }) {
  const currentLink = useRef<HTMLAnchorElement>(null)

  // On a phone the open group's pill may sit off the side of the row, say
  // after following a link to the last group; bring it into view.
  useEffect(() => {
    currentLink.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [current])

  return (
    <nav aria-label="Settings groups" className="settings-menu">
      {SETTINGS_GROUPS.map((group) => (
        <NavLink
          key={group.id}
          to={settingsPath(group.id)}
          ref={group.id === current ? currentLink : undefined}
          className="settings-link"
          // Tabbing along the phone's row moves past its edge; keep the
          // focused pill in view, clear of the fade (see scroll-padding-inline).
          onFocus={(event) =>
            event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          }
        >
          {group.title}
        </NavLink>
      ))}
    </nav>
  )
}
