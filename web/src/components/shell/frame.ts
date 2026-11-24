// Which frame the screen gets, from the window's size: the phone's tab bar,
// a slim rail of tabs for a phone turned sideways, or a computer's sidebar.

import { useMediaQuery } from '../../lib/useMediaQuery'

/**
 * A short screen turned sideways, like a phone in landscape: a bar along the
 * bottom would take too much of the little height, so the tabs stand in a
 * slim rail down the left. Narrower than 560px it is a tiny window, not a
 * phone, and keeps the tab bar.
 */
export const RAIL_QUERY = '(orientation: landscape) and (max-height: 500px) and (min-width: 560px)'

/** Wide enough for a sidebar beside the page: a computer, or a tablet turned sideways. */
export const SIDEBAR_QUERY = '(min-width: 1024px)'

export type Frame = 'tabbar' | 'rail' | 'sidebar'

/** The frame for this window, kept up to date as it is resized or turned. */
export function useFrame(): Frame {
  const rail = useMediaQuery(RAIL_QUERY)
  const sidebar = useMediaQuery(SIDEBAR_QUERY)
  // A short window is a rail even when wide, since a sidebar's foot would not fit its height.
  if (rail) return 'rail'
  return sidebar ? 'sidebar' : 'tabbar'
}
