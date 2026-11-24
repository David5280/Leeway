// A short list of rows, each a link to a page a tap deeper: how a tab leads
// on to its detail pages (Wealth to Debts, Payday to Bills).

import { Link } from 'react-router-dom'
import { Card } from './design/Card'
import { Icon, type IconName } from './ui'

export interface LinkRow {
  to: string
  label: string
  icon: IconName
  /** A few words under the label on what the page holds. */
  detail?: string
}

/** One card of rows, each opening its own page; `label` names the card for screen readers. */
export function LinkRows({ label, rows }: { label: string; rows: LinkRow[] }) {
  return (
    <Card static="list" label={label} className="tight stack-sm">
      {rows.map((row) => (
        <Link key={row.to} to={row.to} className="list-row clickrow link-row">
          <Icon name={row.icon} size={20} />
          <span className="grow stack-sm link-row-words">
            <span className="link-row-label">{row.label}</span>
            {row.detail && <span className="small muted">{row.detail}</span>}
          </span>
          <Icon name="forward" size={18} />
        </Link>
      ))}
    </Card>
  )
}
