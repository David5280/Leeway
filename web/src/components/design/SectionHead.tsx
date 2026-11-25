// A card's title row: a small tinted icon chip and the title, so every
// section reads at a glance before its words do, with an optional figure at
// the end of the row, like a group's total. A section inside a card that has
// its own title takes the next heading level down.

import type { ReactNode } from 'react'
import { Icon, type IconName } from '../ui'

export function SectionHead({
  icon,
  title,
  aside,
  level = 2,
}: {
  icon: IconName
  title: string
  aside?: ReactNode
  /** The heading's level: 3 for a section inside a titled card. */
  level?: 2 | 3
}) {
  const Heading = level === 3 ? 'h3' : 'h2'
  return (
    <div className="section-head">
      <span className="section-icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <Heading>{title}</Heading>
      {aside !== undefined && <span className="section-aside">{aside}</span>}
    </div>
  )
}
