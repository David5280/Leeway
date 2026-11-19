// Where Settings opens when the address names no group it knows: a link from
// before the groups, the group this device opened last, or the first group.

import { findGroup, SETTINGS_GROUPS, type SettingsGroupId } from './groups'
import { settingsPath } from './paths'

/**
 * The anchors of the old one-page screen, like /customize#region, and where
 * each section lives now. A section that opens its group needs no anchor, so
 * the page lands on the group's heading rather than scrolled past it.
 */
const OLD_ANCHORS = new Map<string, string>([
  ['look', settingsPath('appearance')],
  ['layout', settingsPath('appearance', 'layout')],
  ['budgeting', settingsPath('budgeting')],
  ['region', settingsPath('budgeting', 'region')],
  ['accounts', settingsPath('accounts')],
  ['banks', settingsPath('banks')],
  ['agent', settingsPath('assistant')],
  ['email', settingsPath('email')],
  ['data', settingsPath('data')],
  ['account', settingsPath('sign-in')],
])

/** The first group, which Settings opens when nothing else decides. */
const FIRST_GROUP: SettingsGroupId = SETTINGS_GROUPS[0].id

/**
 * The address to open for an address without a known group.
 * `hash` is the address's own, like "#banks"; `remembered` is the group this
 * device opened last, which may be gone from a newer version.
 */
export function landingPath(hash: string, remembered: string | null): string {
  const old = OLD_ANCHORS.get(hash.slice(1))
  if (old) return old
  const group = findGroup(remembered)?.id ?? FIRST_GROUP
  return `/settings/${group}`
}
