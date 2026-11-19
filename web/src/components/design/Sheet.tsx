// A dialog that slides up from the bottom on a phone and in from the right
// on a wider screen. It is a proper modal: focus moves into it and cannot
// leave while it is open, Escape closes it, a swipe down on its handle
// closes it on a phone, and focus goes back to what opened it. Keys are
// heard on the whole document, so Escape and Tab still work when the
// element that had focus was taken away (a view inside the sheet changed).

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui'

/** How far down, in pixels, a swipe must travel to close the sheet. */
export const SWIPE_CLOSE_PX = 80

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** The elements inside `root` that Tab can reach, in order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
}

/**
 * Follows a drag down from the sheet's handle: how far it has gone, and
 * whether letting go there closes the sheet. Upward drags are ignored.
 */
function useSwipeDown(onClose: () => void) {
  const start = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)
  return {
    offset,
    handlers: {
      onPointerDown(event: PointerEvent) {
        start.current = event.clientY
      },
      onPointerMove(event: PointerEvent) {
        if (start.current === null) return
        setOffset(Math.max(0, event.clientY - start.current))
      },
      onPointerUp() {
        const travelled = offset
        start.current = null
        setOffset(0)
        if (travelled >= SWIPE_CLOSE_PX) onClose()
      },
      onPointerCancel() {
        start.current = null
        setOffset(0)
      },
    },
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
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const swipe = useSwipeDown(onClose)

  // Focus moves in on open and back to what opened the sheet on close; the
  // page behind does not scroll while it is open.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      opener?.focus()
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
    <div className="sheet-layer">
      <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={swipe.offset ? { transform: `translateY(${swipe.offset}px)` } : undefined}
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
