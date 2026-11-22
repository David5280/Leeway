// The accounts a new pension could go on, for both ways of adding one (typed
// in, or from a paystub), so it is not counted twice: loaded once, loaded
// again on Try again with focus taken on to the choice, and read again after
// a refusal, such as an account made a pension since the list was shown.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useAction } from '../../../api/hooks'
import { pensionCandidates } from './fields'
import { ACCOUNT_CHOICE_LABEL } from './PensionFields'

/**
 * Where focus goes once the accounts are in after a retry, since the Try
 * again button pressed is gone: the choice of account when there is one, or
 * else the card's heading, made focusable from code only.
 */
function focusInCard(card: HTMLElement): void {
  const choice = card.querySelector<HTMLElement>(`select[aria-label="${ACCOUNT_CHOICE_LABEL}"]`)
  if (choice) return choice.focus()
  const heading = card.querySelector<HTMLElement>('h2')
  if (!heading) return
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
  heading.focus()
}

/**
 * Remembers the card a retry was pressed in, and moves focus within it once
 * loaded turns true. A retry that fails again leaves the card remembered, so
 * the next one that works still moves focus.
 */
function useFocusAfterRetry(loaded: boolean): (pressed: HTMLElement) => void {
  const card = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!loaded || card.current === null) return
    focusInCard(card.current)
    card.current = null
  }, [loaded])
  return (pressed) => {
    card.current = pressed.closest('section')
  }
}

/** The accounts a new pension could go on, when enabled, as both add forms use them. */
export function usePensionCandidates(enabled: boolean) {
  const client = useQueryClient()
  const accounts = useAction('list_accounts', { includeHidden: false }, { enabled })
  const focusAfterRetry = useFocusAfterRetry(accounts.isSuccess)
  return {
    candidates: pensionCandidates(accounts.data ?? []),
    /** Until the accounts are known, a new pension could not be offered the one it belongs on. */
    pending: enabled && accounts.isPending,
    error: enabled ? accounts.error : null,
    /** Loads the accounts again, from the Try again button pressed. */
    retry: (pressed: HTMLElement) => {
      focusAfterRetry(pressed)
      void accounts.refetch()
    },
    /**
     * Reads the accounts and the pensions again after a save was refused, so
     * an account made a pension elsewhere, which the message names, shows as
     * one and is no longer offered.
     */
    refresh: () => {
      void client.invalidateQueries({ queryKey: ['action', 'list_accounts'] })
      void client.invalidateQueries({ queryKey: ['action', 'project_retirement'] })
    },
  }
}
