// A button that opens a short list of actions or choices below it. It
// behaves like a menu should: the first item takes focus on open, arrow keys
// move between items, Escape or a press outside closes it, and focus goes
// back to the button. The list is fixed to the screen, not to its parent, so
// a parent that scrolls sideways (a row of chips) cannot cut it off.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

/** The space kept between the menu and the screen's edges, in pixels. */
const EDGE = 8

/** The space between the menu and its button, in pixels. */
const GAP = 6

/** The part of the screen clear of the notch, the status bar and the home indicator. */
export interface SafeArea {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Places the menu under its button, or over it when it fits only there or
 * has more room there (a button low on a phone turned sideways), moved left
 * if it would run off the right edge, all inside the safe area. It is no
 * taller than the room on its side, and scrolls past that.
 */
export function placeMenu(
  button: DOMRect,
  menu: { width: number; height: number },
  safe: SafeArea,
): { top: number; left: number; maxHeight: number } {
  const left = Math.max(safe.left + EDGE, Math.min(button.left, safe.right - menu.width - EDGE))
  const below = safe.bottom - EDGE - (button.bottom + GAP)
  const above = button.top - GAP - (safe.top + EDGE)
  if (menu.height <= below || below >= above) {
    return { top: button.bottom + GAP, left, maxHeight: Math.max(0, below) }
  }
  const maxHeight = Math.min(menu.height, above)
  return { top: button.top - GAP - maxHeight, left, maxHeight }
}

/** The bars fixed along the bottom of the screen that a menu stays above: the tab bar. */
const BOTTOM_BARS = '.tabbar'

/**
 * The safe area cut short at the top of any bar along its bottom that shows,
 * so a long menu low on a phone ends above the tab bar rather than over it.
 * A hidden bar (the tab bar of a phone turned sideways) takes no room.
 */
export function aboveBars(safe: SafeArea, bars: Iterable<Element>): SafeArea {
  let bottom = safe.bottom
  for (const bar of bars) {
    const box = bar.getBoundingClientRect()
    if (box.height > 0) bottom = Math.min(bottom, box.top)
  }
  return { ...safe, bottom }
}

/** The safe area now, measured from the insets the page is given (--sat and the rest). */
function safeArea(): SafeArea {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;inset:var(--sat) var(--sar) var(--sab) var(--sal)'
  document.body.append(probe)
  const { top, right, bottom, left } = probe.getBoundingClientRect()
  probe.remove()
  return aboveBars({ top, right, bottom, left }, document.querySelectorAll(BOTTOM_BARS))
}

export interface MenuItem {
  key: string
  label: ReactNode
  /** Drawn before the label. */
  icon?: ReactNode
  /** For a choice: whether it is the current one. Leave out for an action. */
  checked?: boolean
  onSelect: () => void
}

export function Menu({
  label,
  button,
  buttonClassName,
  items,
}: {
  /** What the button does, for screen readers: "Add or import". */
  label: string
  /** What the button shows. */
  button: ReactNode
  buttonClassName: string
  items: MenuItem[]
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  // Place the menu before it is painted, so it never shows in the wrong spot.
  useLayoutEffect(() => {
    if (!open) return
    const menu = list.current!
    const size = { width: menu.offsetWidth, height: menu.scrollHeight }
    const place = placeMenu(trigger.current!.getBoundingClientRect(), size, safeArea())
    menu.style.top = `${place.top}px`
    menu.style.left = `${place.left}px`
    menu.style.maxHeight = `${place.maxHeight}px`
  }, [open])

  // Focus the current choice, or the first item, when the menu opens. A
  // press elsewhere closes it, and so does scrolling the page, which would
  // leave it floating away from its button.
  useEffect(() => {
    if (!open) return
    const entries = itemsIn(list.current!)
    const current = entries.find((entry) => entry.getAttribute('aria-checked') === 'true')
    ;(current ?? entries[0])?.focus()
    const outside = (event: Event) => {
      if (!wrap.current!.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('scroll', outside, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('scroll', outside, true)
    }
  }, [open])

  function close() {
    setOpen(false)
    trigger.current!.focus()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      return
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const entries = itemsIn(list.current!)
    const at = entries.indexOf(document.activeElement as HTMLElement)
    entries[(at + step + entries.length) % entries.length]!.focus()
  }

  const choices = items.some((item) => item.checked !== undefined)
  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {button}
      </button>
      {open && (
        <div ref={list} className="menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="menu-item"
              role={choices ? 'menuitemradio' : 'menuitem'}
              aria-checked={choices ? Boolean(item.checked) : undefined}
              tabIndex={-1}
              onClick={() => {
                close()
                item.onSelect()
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function itemsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.menu-item')]
}
