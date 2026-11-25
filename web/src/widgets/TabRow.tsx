// Home's tab row: the four tab cards side by side, in the map's order (cash
// to payday, spending pace, your top goal, net worth), each still opening
// its tab. They sit two by two on a phone and in one row where the row has
// the room (styles/home.css measures the row itself, so a row resized to
// half a wide screen stays two by two). Each card wears its own tab's color.

import type { ComponentType } from 'react'
import type { PlaceId } from '../lib/places'
import { CashToPaydayCard, NetWorthCard, SpendingPaceCard, TopGoalCard } from './TabCards'

/** The four cards, each with the tab whose color its label wears. */
const TAB_CARDS: readonly { place: Exclude<PlaceId, 'home'>; Card: ComponentType }[] = [
  { place: 'pay', Card: CashToPaydayCard },
  { place: 'spend', Card: SpendingPaceCard },
  { place: 'goal', Card: TopGoalCard },
  { place: 'wealth', Card: NetWorthCard },
]

export function TabRowWidget() {
  return (
    <div className="tab-row">
      {TAB_CARDS.map(({ place, Card }) => (
        <div key={place} className="tab-row-slot" data-place={place}>
          <Card />
        </div>
      ))}
    </div>
  )
}
