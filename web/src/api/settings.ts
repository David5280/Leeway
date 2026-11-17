// Saving settings with an instant preview, so look and layout change as you pick.

import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { call, type Input, type Settings } from './client'

export const SETTINGS_KEY = ['action', 'get_settings', {}]
/** Every settings save shares this key, so one screen can watch saves made by many parts. */
const SAVE_KEY = ['update_settings']

/**
 * Saves a settings change and shows it right away: the cached settings are
 * patched first, so theme and layout changes preview live while saving.
 */
export function useUpdateSettings() {
  const client = useQueryClient()
  return useMutation<Settings, Error, Input<'update_settings'>, { previous?: Settings }>({
    mutationKey: SAVE_KEY,
    mutationFn: (patch) => call('update_settings', patch),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: SETTINGS_KEY })
      const previous = client.getQueryData<Settings>(SETTINGS_KEY)
      if (previous) {
        client.setQueryData<Settings>(SETTINGS_KEY, {
          ...previous,
          ...(patch as Partial<Settings>),
          appearance: { ...previous.appearance, ...patch.appearance },
        })
      }
      return { previous }
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) client.setQueryData(SETTINGS_KEY, context.previous)
    },
    onSuccess: (saved) => {
      client.setQueryData(SETTINGS_KEY, saved)
      // The period or pending setting can change every number on screen.
      void client.invalidateQueries({
        queryKey: ['action'],
        predicate: (query) => query.queryKey[1] !== 'get_settings',
      })
    },
  })
}

/**
 * Why the latest settings save failed, from any part of the screen, or null once
 * a later save succeeds. Each section saves through its own mutation, so a
 * single error note has to look across all of them.
 */
export function useSettingsSaveError(): Error | null {
  const saves = useMutationState({
    filters: { mutationKey: SAVE_KEY },
    select: (mutation) => mutation.state.error,
  })
  return saves.at(-1) ?? null
}
