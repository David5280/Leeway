// "Up $1,200 since Nov 2025": how far net worth has come over the range the
// card or chart shows, in green when it grew and in red only when it fell.

import { useApp } from '../lib/app'
import { monthYear } from '../lib/format'
import { changeWords, type WorthChange } from '../lib/worth'
import { Money } from './design/Money'

export function WorthChangeLine({ change }: { change: WorthChange }) {
  const { settings } = useApp()
  const { word, falling } = changeWords(change)
  return (
    <span className="small muted">
      {word} <Money cents={Math.abs(change.changeCents)} tone={falling ? 'problem' : 'in'} /> since{' '}
      {monthYear(change.fromDate, settings.locale)}
    </span>
  )
}
