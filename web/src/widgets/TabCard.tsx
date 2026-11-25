// The shape every Home summary card shares: the tab's name as its label (in
// that tab's color, set on the card's slot by Board), one figure, and a line
// under it with the status. The whole card is one link to the tab or page it
// summarizes, so Home repeats a figure but is never a second place to act.

import type { ReactNode } from 'react'
import { Card } from '../components/design/Card'
import { Icon, LoadingOrError } from '../components/ui'

interface TabCardProps {
  /** The card's name, shown as its label and read out as the link's name. */
  name: string
  /** The tab or page the card opens. */
  to: string
  /** The one figure, or words standing in for it. */
  figure: ReactNode
  /** The status and a few words of context, on their own line so a phone never squeezes them. */
  children?: ReactNode
}

export function TabCard({ name, to, figure, children }: TabCardProps) {
  return (
    <Card to={to} label={name} className="tab-card stack-xs">
      <TabCardLabel name={name} />
      <span className="mid-number">{figure}</span>
      {children && <span className="row wrap tab-card-status small">{children}</span>}
    </Card>
  )
}

/** The card's small label, with an arrow that says the card opens somewhere. */
function TabCardLabel({ name }: { name: string }) {
  return (
    <span className="eyebrow row tab-card-label">
      {name}
      <Icon name="forward" size={14} />
    </span>
  )
}

/** A card still waiting for its figure: its label, and loading or why it could not load. */
export function TabCardWaiting({ name, error }: { name: string; error: Error | null }) {
  return (
    <Card static="empty" label={name} className="tab-card stack-xs">
      <TabCardLabel name={name} />
      <LoadingOrError error={error} />
    </Card>
  )
}
