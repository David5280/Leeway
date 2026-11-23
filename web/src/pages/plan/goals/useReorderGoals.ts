// Putting goals in order from the Goals section. The order and the goal cards
// move at once, before the server answers, with dates worked out by the
// server's own math, and go back as they were if the server refuses.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Goal } from '../../../api/client'
import { call } from '../../../api/client'
import { landings } from '../../../../../server/src/domain/goalOrder'
import type { GoalOrder } from './orderText'

/** The order's and the goals list's places in the cache, as useAction keys them. */
export const ORDER_KEY = ['action', 'get_goal_order', {}] as const
export const GOALS_KEY = ['action', 'list_goals', {}] as const

/** Items in the order of `ids`; any left out keep their order after the ones named. */
export function inOrder<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const place = (item: T) => {
    const index = ids.indexOf(item.id)
    return index === -1 ? ids.length : index
  }
  // Array sort is stable, so the ones left out keep the order they had.
  return [...items].sort((a, b) => place(a) - place(b))
}

/** The order as it will be once `ids` is saved, with dates as the server works them out. */
export function reordered(order: GoalOrder, ids: string[], today: string): GoalOrder {
  const goals = inOrder(order.goals, ids).map(({ id, name, remainingCents, status }) => ({
    id,
    name,
    remainingCents,
    status,
  }))
  return { ...order, goals: landings(goals, order.monthlyCents, today) }
}

/** What the cache held before a move, to put back if the server refuses it. */
interface Before {
  order: GoalOrder | undefined
  goals: Goal[] | undefined
}

/**
 * Saves a new order of goals, showing it at once. `onUndo` hears of a move
 * put back after the server refused it, as soon as the cache holds the old
 * order again.
 */
export function useReorderGoals(today: string, onUndo: (ids: string[]) => void) {
  const client = useQueryClient()
  return useMutation<GoalOrder, Error, { ids: string[] }, Before>({
    mutationFn: (input) => call('reorder_goals', input),
    onMutate: async ({ ids }) => {
      // A read already on its way could land after this and undo the move.
      await client.cancelQueries({ queryKey: ORDER_KEY })
      await client.cancelQueries({ queryKey: GOALS_KEY })
      const before = {
        order: client.getQueryData<GoalOrder>(ORDER_KEY),
        goals: client.getQueryData<Goal[]>(GOALS_KEY),
      }
      client.setQueryData<GoalOrder>(ORDER_KEY, (order) => order && reordered(order, ids, today))
      client.setQueryData<Goal[]>(GOALS_KEY, (goals) => goals && inOrder(goals, ids))
      return before
    },
    onError: (_error, { ids }, before) => {
      client.setQueryData(ORDER_KEY, before?.order)
      client.setQueryData(GOALS_KEY, before?.goals)
      onUndo(ids)
    },
    // The order touches more than this screen (the check-in, the profile), so every read refreshes.
    onSettled: () => client.invalidateQueries({ queryKey: ['action'] }),
  })
}
