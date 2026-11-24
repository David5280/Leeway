// The keyboard's way to "Ask about this" on a card with nothing to focus.
//
// The context menu key and Shift+F10 reach a card through whatever inside
// it holds focus: a drill-down's button, a link, a list's rows, a form's
// buttons. A card of only words or a figure has nothing, so it would be the
// one card the keyboard could not ask about. Such a card, and only such a
// card, becomes a tab stop itself while Ask Leeway is on. Cards the
// keyboard already reaches gain nothing, so Tab does not stop twice on
// them, and without an AI key no card gains a stop at all.
//
// The card is watched as it changes (a loading state that fills in, a list
// that empties), so the stop comes and goes with what is inside it.

import { useEffect, useState } from 'react'

/** What Tab can land on inside a card, matching the Sheet's own list. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable], [tabindex]:not([tabindex="-1"])'

/** Whether anything inside `card` (not the card itself) can take focus. */
export function hasFocusable(card: HTMLElement): boolean {
  return card.querySelector(FOCUSABLE) !== null
}

/** The props for the card's outer element: a ref to watch it, and a tab stop when it needs one. */
export interface KeyboardReach {
  ref?: (card: HTMLElement | null) => void
  tabIndex?: 0
}

/** A tab stop for the card while `enabled` (Ask Leeway is on) and nothing inside it can take focus. */
export function useKeyboardReach(enabled: boolean): KeyboardReach {
  const [card, setCard] = useState<HTMLElement | null>(null)
  // Assumed reachable until looked at, so no card flashes a stop it does not need.
  const [reachable, setReachable] = useState(true)

  useEffect(() => {
    if (!enabled || !card) return
    const look = () => setReachable(hasFocusable(card))
    look()
    const observer = new MutationObserver(look)
    observer.observe(card, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'disabled', 'tabindex', 'contenteditable'],
    })
    return () => observer.disconnect()
  }, [enabled, card])

  if (!enabled) return {}
  return reachable ? { ref: setCard } : { ref: setCard, tabIndex: 0 }
}
