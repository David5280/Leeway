// The five tabs, each a question the app answers, in the order the tab bar,
// the sidebar and the number keys share. Everything here is plain data and
// pure functions, so the shell's pieces and their tests read the same list.

import { paths } from '../../routes'
import type { IconName } from '../ui'

export interface Tab {
  /** Where the tab opens; its deeper pages share this start (see tabFor). */
  to: string
  label: string
  icon: IconName
}

export const TABS: readonly Tab[] = [
  { to: paths.home(), label: 'Home', icon: 'overview' },
  { to: paths.spending(), label: 'Spending', icon: 'budgets' },
  { to: paths.payday(), label: 'Payday', icon: 'wallet' },
  { to: paths.goals(), label: 'Goals', icon: 'target' },
  { to: paths.wealth(), label: 'Wealth', icon: 'growth' },
]

/**
 * The tab a path belongs to: the tab whose address it is, or starts with
 * followed by a slash, so /spending/activity lights Spending. Home owns only
 * "/" itself, so the Inbox, Alerts, Settings and Chat light no tab.
 */
export function tabFor(pathname: string): Tab | undefined {
  return TABS.find((tab) =>
    tab.to === '/' ? pathname === '/' : pathname === tab.to || pathname.startsWith(`${tab.to}/`),
  )
}

/** Where focus means typing, so a number key is the person's, never a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.matches('input, textarea, select')
}

/** The key presses tabKey reads. */
type KeyPress = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'target' | 'defaultPrevented'
>

/**
 * The tab a key press switches to: keys 1 to 5, pressed alone, while focus is
 * not in a field. Undefined for every other press, which is left to the page.
 */
export function tabKey(press: KeyPress): Tab | undefined {
  if (press.defaultPrevented) return undefined
  if (press.altKey || press.ctrlKey || press.metaKey || press.shiftKey) return undefined
  if (isTyping(press.target)) return undefined
  // Only a single digit: "10" never arrives as one key, and "0" has no tab.
  if (!/^[1-9]$/.test(press.key)) return undefined
  return TABS[Number(press.key) - 1]
}
