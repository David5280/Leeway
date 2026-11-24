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
// A card with nothing focusable inside is given one tab stop, so the
// keyboard can reach it too (useKeyboardReach.ts).
// Without an AI key it does nothing at all.

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { useAskOffered } from './AskFab'
import { cardAbout } from './cardAbout'
import { useKeyboardReach } from './useKeyboardReach'

/** How long a press must be held to ask about the card, in milliseconds. */
export const HOLD_MS = 500

/** How far a press may drift and still be a hold, in pixels. */
export const HOLD_SLOP_PX = 10

/**
 * How long after a held press is let go its click may still arrive, in
 * milliseconds. Past it no click is swallowed, even when the release landed
 * off the card (or on the box it opened) and the card never saw a click.
 */
export const HELD_CLICK_MS = 300

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
  ref?: (card: HTMLElement | null) => void
  tabIndex?: 0
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
 * The `held` flag's life: set when a hold opens Ask Leeway, and cleared
 * HELD_CLICK_MS after the press is let go anywhere on the page. The card's
 * own click (when it comes) clears it sooner; this covers the release that
 * never becomes the card's click, which would otherwise leave the flag set
 * to swallow the next Enter or click on the card.
 */
function useHeldRelease() {
  const held = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = useRef<() => void>(() => {})

  const reset = useCallback(() => {
    stop.current()
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    held.current = false
  }, [])
  useEffect(() => reset, [reset])

  const hold = useCallback(() => {
    held.current = true
    // Heard on the whole document, captured: the release may land on the box or off the card.
    const letGo = () => {
      stop.current()
      timer.current = setTimeout(() => (held.current = false), HELD_CLICK_MS)
    }
    document.addEventListener('pointerup', letGo, { capture: true })
    document.addEventListener('pointercancel', letGo, { capture: true })
    stop.current = () => {
      document.removeEventListener('pointerup', letGo, { capture: true })
      document.removeEventListener('pointercancel', letGo, { capture: true })
      stop.current = () => {}
    }
  }, [])

  /** Whether a hold opened Ask Leeway, so the click it ends with is to be swallowed. */
  const isHeld = useCallback(() => held.current, [])
  return { isHeld, hold, reset }
}

/**
 * Press and hold for a card named `label` (or by the name it shows). Spread
 * the result on the card's outer element.
 */
export function useCardHold(label: string | undefined): HoldHandlers {
  const ask = useAskOffered()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const stopListening = useRef<() => void>(() => {})
  const release = useHeldRelease()
  const reach = useKeyboardReach(ask !== null)

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
    ...reach,
    onPointerDown(event) {
      if (!event.isPrimary || event.button !== 0 || !isCardsOwn(event)) return
      cancel()
      release.reset()
      const card = event.currentTarget
      start.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        cancel()
        if (hasSelection(card)) return
        release.hold()
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
      if (!release.isHeld() || !isCardsOwn(event)) return
      release.reset()
      event.preventDefault()
      event.stopPropagation()
    },
    onContextMenu(event) {
      if (!isCardsOwn(event) || hasSelection(event.currentTarget)) return
      event.preventDefault()
      cancel()
      // A long press on a phone raises this too, after the hold already asked.
      if (!release.isHeld()) askAbout(event.currentTarget)
    },
    onKeyDown(event) {
      if (!isMenuKey(event) || !isCardsOwn(event)) return
      event.preventDefault()
      askAbout(event.currentTarget)
    },
  }
}
