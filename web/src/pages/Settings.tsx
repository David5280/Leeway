// The Settings screen: every setting, sorted into groups with a menu beside
// them, each group at its own address like /settings/banks. All of it saves live.

import { useEffect } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useSettingsSaveError } from '../api/settings'
import { Shell } from '../components/Shell'
import { ErrorNote } from '../components/ui'
import { findGroup, type SettingsGroup } from './settings/groups'
import { GroupMenu } from './settings/GroupMenu'
import { GroupPanel } from './settings/GroupPanel'
import { landingPath } from './settings/landing'
import { rememberedGroup, rememberGroup } from './settings/lastGroup'

export function SettingsPage() {
  const { group: id } = useParams()
  const { hash } = useLocation()
  const group = findGroup(id)
  // No group, or one this version does not have: pick one, and say so in the address.
  if (!group) return <Navigate to={landingPath(hash, rememberedGroup())} replace />
  return <SettingsScreen group={group} />
}

function SettingsScreen({ group }: { group: SettingsGroup }) {
  const saveError = useSettingsSaveError()
  useScrollToSection()
  useEffect(() => rememberGroup(group.id), [group.id])

  return (
    <Shell>
      <div>
        <h1>Settings</h1>
        <span className="muted">Every change saves right away and shows live.</span>
      </div>
      <ErrorNote error={saveError} />
      <div className="settings">
        <GroupMenu current={group.id} />
        <GroupPanel group={group} />
      </div>
    </Shell>
  )
}

/** Scrolls to the section an address names, like /settings/budgeting#region. */
function useScrollToSection() {
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [hash])
}

/** Sends an address from when Settings was called Customize to the same place now. */
export function OldSettingsAddress() {
  const { group } = useParams()
  const { search, hash } = useLocation()
  const pathname = group ? `/settings/${encodeURIComponent(group)}` : '/settings'
  return <Navigate to={{ pathname, search, hash }} replace />
}
