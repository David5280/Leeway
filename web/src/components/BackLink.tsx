// The way back from a page a tap deeper to the page it was opened from.

import { Link } from 'react-router-dom'
import { Icon } from './ui'

/** A small link with a back arrow, named for where it goes ("Wealth"). */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="linkbtn tap back-link">
      <Icon name="back" size={16} />
      {label}
    </Link>
  )
}
