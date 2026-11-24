// Press and hold any card to ask Leeway about just that card. A finger or a
// mouse held still for HOLD_MS, a right click, or the keyboard's context
// menu key (or Shift+F10) on a focused card opens the conversation about it,
// carrying its name and the figure it shows.
//
// Everything else a card does is left alone:
//   - a tap or click still opens its drill-down or page: only a press held
//     to the end swallows the click that follows it;
//   - a press that moves (a scroll, a drag to select text) or a scroll of
//     the page cancels the hold;
//   - with text selected in the card, a right click keeps the browser's own
//     menu, for copying;
//   - presses in a field, or inside a sheet the card opened (React passes
//     those up through the portal), are not the card's.
// Without an AI key it does nothing at all.

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { useAskOffered } from './AskDock'
import { cardAbout } from './cardAbout'

/** How long a press must be held to ask about the card, in milliseconds. */
export const HOLD_MS = 500

/** How far a press may drift and still be a hold, in pixels. */
export const HOLD_SLOP_PX = 10

/** The handlers a card's surface takes; none at all without Ask Leeway. */
export interface HoldHandlers {
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void
  onPointerUp?: () => void
  onPointerCancel?: () => void
  onPointerLeave?: () => void
  onClickCapture?: (event: MouseEvent<HTMLElement>) => void
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  'data-ask-hold'?: true
}

/** Whether an event started inside the card itself, not in a field or a sheet it opened. */
function isCardsOwn(event: { currentTarget: HTMLElement; target: EventTarget }): boolean {
  const target = event.target
  if (!(target instanceof Node) || !event.currentTarget.contains(target)) return false
  return !(
    target instanceof Element && target.closest('input, textarea, select, [contenteditable]')
  )
}

/** Whether the owner has text selected inside the card, which a hold must not take over. */
function hasSelection(card: HTMLElement): boolean {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && card.contains(selection.anchorNode)
}

/** The keys that open a focused element's context menu. */
function isMenuKey(event: KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}

/**
 * Press and hold for a card named `label` (or by the name it shows). Spread
 * the result on the card's outer element.
 */
export function useCardHold(label: string | undefined): HoldHandlers {
  const ask = useAskOffered()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  // A hold that opened Ask Leeway, so the click it ends with is swallowed.
  const held = useRef(false)
  const stopListening = useRef<() => void>(() => {})

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
    stopListening.current()
  }, [])
  // A card leaving the screen mid-hold leaves no timer or listener behind.
  useEffect(() => cancel, [cancel])

  if (!ask) return {}
  // Opening twice (a menu key, then the context menu it raises) is harmless: the second only refocuses.
  const askAbout = (card: HTMLElement) => ask.open(cardAbout(card, label))

  return {
    'data-ask-hold': true,
    onPointerDown(event) {
      if (!event.isPrimary || event.button !== 0 || !isCardsOwn(event)) return
      cancel()
      held.current = false
      const card = event.currentTarget
      start.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        cancel()
        if (hasSelection(card)) return
        held.current = true
        askAbout(card)
      }, HOLD_MS)
      // Any scroll, of the page or a list inside it, means the finger is scrolling, not holding.
      document.addEventListener('scroll', cancel, { capture: true, passive: true, once: true })
      stopListening.current = () =>
        document.removeEventListener('scroll', cancel, { capture: true })
    },
    onPointerMove(event) {
      if (!start.current) return
      const moved = Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y)
      if (moved > HOLD_SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture(event) {
      if (!held.current || !isCardsOwn(event)) return
      held.current = false
      event.preventDefault()
      event.stopPropagation()
    },
    onContextMenu(event) {
      if (!isCardsOwn(event) || hasSelection(event.currentTarget)) return
      event.preventDefault()
      cancel()
      // A long press on a phone raises this too, after the hold already asked.
      if (!held.current) askAbout(event.currentTarget)
    },
    onKeyDown(event) {
      if (!isMenuKey(event) || !isCardsOwn(event)) return
      event.preventDefault()
      askAbout(event.currentTarget)
    },
  }
}
