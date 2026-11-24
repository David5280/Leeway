// Which frame the screen gets, from the window's size: the phone's tab bar,
// one slim top row for a phone turned sideways, or a computer's sidebar.

import { useMediaQuery } from '../../lib/useMediaQuery'

/**
 * A short screen turned sideways, like a phone in landscape: a bar along the
 * bottom would take too much of the little height, so the tabs move into the
 * slim top row. A rail down the left was tried and took too much of the width
 * the page's own layouts count on. Narrower than 560px it is a tiny window,
 * not a phone, and keeps the tab bar.
 */
export const SHORT_QUERY = '(orientation: landscape) and (max-height: 500px) and (min-width: 560px)'

/** Wide enough for a sidebar beside the page: a computer, or a tablet turned sideways. */
export const SIDEBAR_QUERY = '(min-width: 1024px)'

export type Frame = 'tabbar' | 'short' | 'sidebar'

/** The frame for this window, kept up to date as it is resized or turned. */
export function useFrame(): Frame {
  const short = useMediaQuery(SHORT_QUERY)
  const sidebar = useMediaQuery(SIDEBAR_QUERY)
  // A short window keeps the top row even when wide, since a sidebar's foot would not fit its height.
  if (short) return 'short'
  return sidebar ? 'sidebar' : 'tabbar'
}
