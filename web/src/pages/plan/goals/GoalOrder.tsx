// "Which goal comes first?": the owner's goals in order, each with the month
// it lands in when the monthly amount fills them one after another, and up and
// down buttons to change the order. Under the list, the trade-off of the next
// move said plainly, and after a move, what it did to the dates. A move shows
// at once and keeps focus on the goal that moved, so moves can be repeated
// from the keyboard.

import { useEffect, useRef, useState } from 'react'
import { useAction } from '../../../api/hooks'
import { Card } from '../../../components/design/Card'
import { ErrorNote, Icon } from '../../../components/ui'
import { landingChanges, moveId } from '../../../../../server/src/domain/goalOrder'
import { useApp } from '../../../lib/app'
import { GoalAmount } from './GoalAmount'
import {
  changesText,
  firstTradeOff,
  landingText,
  orderBars,
  orderKey,
  type GoalOrder,
  type Landing,
  type OrderBar,
} from './orderText'
import { useReorderGoals } from './useReorderGoals'

/** A step through the order: up one place (-1) or down one (+1). */
type Step = -1 | 1

/** One goal's row: its place, name, landing month, stretch on the timeline and move buttons. */
function OrderRow({
  goal,
  index,
  count,
  bar,
  onMove,
}: {
  goal: Landing
  index: number
  count: number
  bar: OrderBar | null
  onMove: (step: Step) => void
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
          data-goal={goal.id}
          data-step={-1}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <Icon name="up" size={16} />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label={`Move ${goal.name} down`}
          data-goal={goal.id}
          data-step={1}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <Icon name="down" size={16} />
        </button>
      </span>
    </li>
  )
}

/** Where focus goes once the order shows a goal at `index`: its button for `step`. */
interface FocusTarget {
  id: string
  step: Step
  index: number
}

/** The moved goal's same button, or its other one at an end, where the same one is off. */
function buttonFor(list: HTMLElement, { id, step }: FocusTarget): HTMLButtonElement | null {
  const button = (s: Step) =>
    list.querySelector<HTMLButtonElement>(`button[data-goal="${id}"][data-step="${s}"]`)
  const same = button(step)
  return same && !same.disabled ? same : button(step === -1 ? 1 : -1)
}

/** What the last move did to the dates, and the order it was said of. */
interface Moved {
  text: string | null
  key: string
}

/** The list and its move buttons, with what the last move did to the dates. */
function OrderList({ order, today }: { order: GoalOrder; today: string }) {
  const { settings } = useApp()
  const [moved, setMoved] = useState<Moved | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  // Kept in refs, not state: focusing needs no render of its own. backRef
  // is where the goal being moved goes back to, should the server refuse.
  const focusRef = useRef<FocusTarget | null>(null)
  const backRef = useRef<FocusTarget | null>(null)
  // The move was put back, so focus follows the goal back to where it was.
  const reorder = useReorderGoals(today, () => (focusRef.current = backRef.current))
  const goals = order.goals
  const bars = orderBars(goals, today)

  // Moving a row in the page drops focus from it, so once the order shows
  // the moved goal where it was headed (or back, when refused), its button
  // gets focus again, unless the owner has since gone elsewhere on the page.
  useEffect(() => {
    const target = focusRef.current
    const list = listRef.current
    if (!target || !list || goals[target.index]?.id !== target.id) return
    focusRef.current = null
    const active = document.activeElement
    if (active === document.body || list.contains(active)) buttonFor(list, target)?.focus()
  }, [goals])

  function move(index: number, step: Step) {
    // One move at a time: a second press while one is saving does nothing.
    if (reorder.isPending) return
    const goal = goals[index]!
    const ids = moveId(
      goals.map((one) => one.id),
      index,
      step,
    )
    focusRef.current = { id: goal.id, step, index: index + step }
    backRef.current = { id: goal.id, step, index }
    reorder.mutate(
      { ids },
      {
        onSuccess: (next) =>
          setMoved({
            text: changesText(landingChanges(goals, next.goals), settings.locale),
            key: orderKey(next),
          }),
      },
    )
  }

  // Said only while the order still reads as the move left it: a new amount
  // or target since then changes the dates it names.
  const movedText = moved?.key === orderKey(order) ? moved.text : null
  const hint = firstTradeOff(goals, settings.locale)

  return (
    <>
      {/* role="list" keeps the list, and so each goal's place, read out where styles hide markers. */}
      <ol ref={listRef} className="order-list" role="list" aria-label="Goals in order">
        {goals.map((goal, index) => (
          <OrderRow
            key={goal.id}
            goal={goal}
            index={index}
            count={goals.length}
            bar={bars[index]!}
            onMove={(step) => move(index, step)}
          />
        ))}
      </ol>
      {movedText ? (
        <p className="small" role="status">
          {movedText}
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
