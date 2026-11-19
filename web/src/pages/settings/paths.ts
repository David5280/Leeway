// Addresses inside Settings, for links from anywhere in the app. Only the
// group ids' type comes from the group list, so linking here pulls in no screens.

import type { SettingsGroupId } from './groups'

/** The route the app's router gives the Settings screen; the group is optional. */
export const SETTINGS_ROUTE = '/settings/:group?'

/** The route Settings had when it was called Customize; it now redirects (see App.tsx). */
export const OLD_SETTINGS_ROUTE = '/customize/:group?'

/**
 * A group's address, like /settings/banks, or a section in it, like
 * /settings/budgeting#region, which scrolls to that section.
 */
export function settingsPath(group: SettingsGroupId, section?: string): string {
  return section ? `/settings/${group}#${section}` : `/settings/${group}`
}
