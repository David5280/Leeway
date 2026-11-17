// React Query hooks for reading and changing data through actions.

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { call, type ActionName, type Input, type Output } from './client'

/** Reads through an action, cached by its name and input. */
export function useAction<N extends ActionName>(
  name: N,
  input?: Input<N>,
  options: Omit<UseQueryOptions<Output<N>>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery<Output<N>>({
    queryKey: ['action', name, input ?? {}],
    queryFn: () => call(name, input),
    ...options,
  })
}

/**
 * Changes something through an action. Afterwards every cached read is
 * refreshed: the data is small, and one change (a rule, a category) can
 * move numbers on every screen.
 */
export function useActionMutation<N extends ActionName>(name: N) {
  const client = useQueryClient()
  return useMutation<Output<N>, Error, Input<N>>({
    mutationFn: (input) => call(name, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['action'] }),
  })
}
