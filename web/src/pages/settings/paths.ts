// Addresses inside Settings, for links from anywhere in the app. Only the
// group ids' type comes from the group list, so linking here pulls in no screens.

import type { SettingsGroupId } from './groups'

/**
 * A group's address, like /settings/banks, or a section in it, like
 * /settings/budgeting#region, which scrolls to that section.
 */
export function settingsPath(group: SettingsGroupId, section?: string): string {
  return section ? `/settings/${group}#${section}` : `/settings/${group}`
}
