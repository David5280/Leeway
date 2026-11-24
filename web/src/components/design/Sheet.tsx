// A dialog that slides up from the bottom on a phone and in from the right
// on a wider screen. It is a proper modal: focus moves into it and cannot
// leave while it is open, Escape closes it, a swipe down on its handle
// closes it on a phone (and slides it back when the swipe falls short), and
// focus goes back to what opened it, or to a fallback when that is gone. Keys are
// heard on the whole document, so Escape and Tab still work when the
// element that had focus was taken away (a view inside the sheet changed).
// A press on the dimmed page closes it, but not in its first moment: the
// release of the press that opened it (a card held to ask about it, on a
// phone) can land on the scrim as a click, and must not close it at once.

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui'

/** How far down, in pixels, a swipe must travel to close the sheet. */
export const SWIPE_CLOSE_PX = 80

/** How long after opening a press on the dimmed page is ignored, in milliseconds. */
export const SCRIM_SETTLE_MS = 350

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** The elements inside `root` that Tab can reach, in order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
}

/**
 * Makes everything on the page but the sheet inert while it is open, so
 * nothing behind it can be tapped, focused or read, as a modal dialog must.
 * Returns how to undo it, leaving alone anything that was inert already
 * (the page behind a sheet opened from another).
 */
function inertBehind(layer: HTMLElement): () => void {
  const behind = [...document.body.children].filter(
    (element) => element !== layer && !element.hasAttribute('inert'),
  )
  for (const element of behind) element.setAttribute('inert', '')
  return () => {
    for (const element of behind) element.removeAttribute('inert')
  }
}

/**
 * Follows a drag down from the sheet's handle: how far it has gone, and
 * whether letting go there closes the sheet. Upward drags are ignored. The
 * handle captures the pointer, so a finger that slides off it still drags;
 * a drag let go short, cancelled or taken by the browser slides back up
 * (the .sheet transition in design.css).
 */
function useSwipeDown(onClose: () => void) {
  const [start, setStart] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const release = () => {
    setStart(null)
    setOffset(0)
  }
  return {
    offset,
    dragging: start !== null,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        event.currentTarget.setPointerCapture(event.pointerId)
        setStart(event.clientY)
      },
      onPointerMove(event: PointerEvent) {
        if (start === null) return
        setOffset(Math.max(0, event.clientY - start))
      },
      onPointerUp() {
        release()
        if (offset >= SWIPE_CLOSE_PX) onClose()
      },
      onPointerCancel: release,
      onLostPointerCapture: release,
    },
  }
}

/**
 * Closes the sheet from a press on the dimmed page, once SCRIM_SETTLE_MS
 * have passed since it opened; a click before then is the press that
 * opened it, let go.
 */
function useScrimClose(onClose: () => void) {
  const settled = useRef(false)
  useEffect(() => {
    const timer = setTimeout(() => (settled.current = true), SCRIM_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [])
  return () => {
    if (settled.current) onClose()
  }
}

/**
 * Keeps Tab inside the sheet: past the last element goes to the first, and
 * Shift+Tab before the first goes to the last. Focus outside the sheet (on
 * the page, or nowhere) comes back in at the near end.
 */
function keepTabInside(root: HTMLElement, event: KeyboardEvent) {
  const items = focusables(root)
  const active = document.activeElement
  const inside = root.contains(active) && active !== root
  const atStart = !inside || active === items[0]
  const atEnd = !inside || active === items.at(-1)
  if (event.shiftKey && atStart) {
    event.preventDefault()
    items.at(-1)?.focus()
  } else if (!event.shiftKey && atEnd) {
    event.preventDefault()
    items[0]?.focus()
  }
}

export function Sheet({
  title,
  subtitle,
  leading,
  trailing,
  focusKey,
  focusOnClose,
  onClose,
  children,
}: {
  /** The dialog's name, shown at its top and read when it opens. */
  title: ReactNode
  /** A muted line under the title. */
  subtitle?: ReactNode
  /** Drawn before the title, like an icon. */
  leading?: ReactNode
  /** Drawn at the end of the title's row, like an amount. */
  trailing?: ReactNode
  /**
   * Changes when the sheet shows a different view; focus then goes back to
   * the sheet, so it is never left on an element that is gone.
   */
  focusKey?: string
  /**
   * Where focus goes on close when what opened the sheet has left the page
   * meanwhile, like a list row filed out of the list from inside the sheet.
   */
  focusOnClose?: () => HTMLElement | null | undefined
  onClose: () => void
  children: ReactNode
}) {
  const layer = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const swipe = useSwipeDown(onClose)
  const onScrimClick = useScrimClose(onClose)
  // The latest fallback, read on close, after the sheet's last render.
  const fallback = useRef(focusOnClose)
  useEffect(() => {
    fallback.current = focusOnClose
  })

  // Focus moves in on open and back to what opened the sheet on close; the
  // page behind is inert and does not scroll while it is open. Only up and
  // down are locked, so nothing wider than the screen is ever cut off unseen.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const overflowY = document.body.style.overflowY
    document.body.style.overflowY = 'hidden'
    const restore = inertBehind(layer.current!)
    return () => {
      // The page comes back first: an inert opener cannot take focus.
      restore()
      document.body.style.overflowY = overflowY
      if (opener?.isConnected) opener.focus()
      else fallback.current?.()?.focus()
    }
  }, [])

  useEffect(() => panel.current?.focus(), [focusKey])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'Tab') keepTabInside(panel.current!, event)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div ref={layer} className="sheet-layer">
      <div className="sheet-scrim" aria-hidden="true" onClick={onScrimClick} />
      <div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // While dragged it follows the finger at once; let go, it eases back.
        style={
          swipe.dragging
            ? { transform: `translateY(${swipe.offset}px)`, transition: 'none' }
            : undefined
        }
      >
        <div className="sheet-bar">
          <div className="sheet-handle" {...swipe.handlers} aria-hidden="true">
            <span className="sheet-grabber" />
          </div>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="sheet-head">
          {leading}
          <div className="sheet-heading">
            <h2 id={titleId} className="sheet-title">
              {title}
            </h2>
            {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
          </div>
          {trailing}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
