// "Which goal comes first?": the owner's goals in order, each with the month
// it lands in when the monthly amount fills them one after another, and up and
// down buttons to change the order. Under the list, the trade-off of the next
// move said plainly, and after a move, what it did to the dates.

import { useState } from 'react'
import { useAction, useActionMutation } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { ErrorNote, Icon } from '../../../components/ui'
import { landingChanges, moveId } from '../../../../../server/src/domain/goalOrder'
import { useApp } from '../../../lib/app'
import { GoalAmount } from './GoalAmount'
import {
  changesText,
  landingText,
  moveUpText,
  orderBars,
  type GoalOrder,
  type Landing,
  type OrderBar,
} from './orderText'

/** One goal's row: its place, name, landing month, stretch on the timeline and move buttons. */
function OrderRow({
  goal,
  index,
  count,
  bar,
  busy,
  onMove,
}: {
  goal: Landing
  index: number
  count: number
  bar: OrderBar | null
  busy: boolean
  onMove: (step: -1 | 1) => void
}) {
  const { settings } = useApp()
  return (
    <li className="order-row">
      <span className="order-rank num small muted" aria-hidden="true">
        {index + 1}
      </span>
      <span className="order-main">
        <span className="row-between wrap order-words">
          <span className="order-name">{goal.name}</span>
          <span className="small muted">{landingText(goal, settings.locale)}</span>
        </span>
        {/* The timeline is drawn only; the landing month beside the name says it in words. */}
        <span className="order-track" aria-hidden="true">
          {bar && (
            <span
              className="order-fill"
              style={{
                left: `${bar.startPercent}%`,
                width: `${bar.endPercent - bar.startPercent}%`,
              }}
            />
          )}
        </span>
      </span>
      <span className="order-moves">
        <button
          type="button"
          className="iconbtn"
          aria-label={`Move ${goal.name} up`}
          disabled={index === 0 || busy}
          onClick={() => onMove(-1)}
        >
          <Icon name="up" size={16} />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label={`Move ${goal.name} down`}
          disabled={index === count - 1 || busy}
          onClick={() => onMove(1)}
        >
          <Icon name="down" size={16} />
        </button>
      </span>
    </li>
  )
}

/** The list and its move buttons, with what the last move did to the dates. */
function OrderList({ order, today }: { order: GoalOrder; today: string }) {
  const { settings } = useApp()
  const reorder = useActionMutation('reorder_goals')
  const [moved, setMoved] = useState<string | null>(null)
  const goals = order.goals
  const bars = orderBars(goals, today)
  // The trade-off worth saying first: moving the second goal ahead of the first.
  const hint = goals[1] ? moveUpText(goals[1], settings.locale) : null

  function move(index: number, step: -1 | 1) {
    const ids = moveId(
      goals.map((goal) => goal.id),
      index,
      step,
    )
    reorder.mutate(
      { ids },
      {
        onSuccess: (next) =>
          setMoved(changesText(landingChanges(goals, next.goals), settings.locale)),
      },
    )
  }

  return (
    <>
      <ol className="order-list" aria-label="Goals in order">
        {goals.map((goal, index) => (
          <OrderRow
            key={goal.id}
            goal={goal}
            index={index}
            count={goals.length}
            bar={bars[index]!}
            busy={reorder.isPending}
            onMove={(step) => move(index, step)}
          />
        ))}
      </ol>
      {moved ? (
        <p className="small" role="status">
          {moved}
        </p>
      ) : (
        hint && <p className="small muted">{hint}</p>
      )}
      <ErrorNote error={reorder.error} />
    </>
  )
}

/** The card, shown once two or more goals compete for the same money. */
export function GoalOrderCard({ today }: { today: string }) {
  const order = useAction('get_goal_order')
  if (!order.data) return null
  return (
    <Card static="form" label="Which goal comes first?" className="stack">
      <h2>Which goal comes first?</h2>
      <GoalAmount order={order.data} />
      <OrderList order={order.data} today={today} />
    </Card>
  )
}
