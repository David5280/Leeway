// A card's title row: a small tinted icon chip and the title, so every
// section reads at a glance before its words do.

import { Icon, type IconName } from '../ui'

export function SectionHead({ icon, title }: { icon: IconName; title: string }) {
  return (
    <div className="section-head">
      <span className="section-icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <h2>{title}</h2>
    </div>
  )
}
