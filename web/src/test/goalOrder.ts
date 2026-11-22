// Goals in order for tests: a $2,000 trip, a $4,000 car and a $1,000 laptop,
// the order the server works out for them from its own math, and a server for
// the Goals section that keeps the order and the amount as they are saved.

import { screen } from '@testing-library/react'
import type { Goal } from '../api/client'
import { landings, type OrderedGoal } from '../../../server/src/domain/goalOrder'
import { inOrder } from '../pages/plan/goals/useReorderGoals'
import type { GoalOrder } from '../pages/plan/goals/orderText'
import { goal, planServer, TODAY } from './planning'

export const trip = goal({ id: 'goal-trip', name: 'Trip', targetCents: 200_000 })
export const car = goal({ id: 'goal-car', name: 'Car', targetCents: 400_000 })
export const laptop = goal({ id: 'goal-laptop', name: 'Laptop', targetCents: 100_000 })

/** The order as the server works it out, from its own math, at $500 a month unless told. */
export function orderOf(
  goals: Goal[],
  monthlyCents = 50_000,
  source: GoalOrder['source'] = 'entered',
): GoalOrder {
  const ordered: OrderedGoal[] = goals.map(({ id, name, remainingCents, status }) => ({
    id,
    name,
    remainingCents,
    status,
  }))
  return { monthlyCents, source, goals: landings(ordered, monthlyCents, TODAY) }
}

/** The pace the server reports when the owner hands the amount back to it. */
const FOUND_CENTS = 30_000

/**
 * The Goals section's server, starting from `first`, that saves a new order
 * and a new amount as the real one does, so a read after either agrees.
 */
export function serveOrder(
  first: GoalOrder,
  goals: Goal[] = [trip, car],
  routes: Record<string, () => Response> = {},
) {
  let listed = goals
  let order = first
  return planServer(
    {
      list_goals: () => listed,
      list_accounts: () => [],
      get_goal_order: () => order,
      reorder_goals: (input) => {
        listed = inOrder(listed, input.ids as string[])
        order = orderOf(listed, order.monthlyCents, order.source)
        return order
      },
      update_settings: (patch) => {
        const plan = patch.savingsPlan as { goalsMonthlyCents: number | null }
        const entered = plan.goalsMonthlyCents
        order =
          entered === null
            ? orderOf(listed, FOUND_CENTS, 'found')
            : orderOf(listed, entered, 'entered')
        return patch
      },
    },
    routes,
  )
}

/**
 * A route that answers only once `answer` settles, to see the screen while a
 * save is on its way. The fake fetch awaits whatever a route returns.
 */
export function held(answer: Promise<Response>): () => Response {
  return (() => answer) as unknown as () => Response
}

/** The order's card. */
export const orderCard = () => screen.findByRole('region', { name: 'Which goal comes first?' })
