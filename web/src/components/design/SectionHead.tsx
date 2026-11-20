// A card's title row: a small tinted icon chip and the title, so every
// section reads at a glance before its words do, with an optional figure at
// the end of the row, like a group's total.

import type { ReactNode } from 'react'
import { Icon, type IconName } from '../ui'

export function SectionHead({
  icon,
  title,
  aside,
}: {
  icon: IconName
  title: string
  aside?: ReactNode
}) {
  return (
    <div className="section-head">
      <span className="section-icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <h2>{title}</h2>
      {aside !== undefined && <span className="section-aside">{aside}</span>}
    </div>
  )
}
