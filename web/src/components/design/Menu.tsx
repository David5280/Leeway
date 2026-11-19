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

/**
 * Places the menu under its button, moved left if it would run off the
 * right edge, and no taller than the room below.
 */
export function placeMenu(
  button: DOMRect,
  menuWidth: number,
  screen: { width: number; height: number },
): { top: number; left: number; maxHeight: number } {
  const top = button.bottom + 6
  const left = Math.max(EDGE, Math.min(button.left, screen.width - menuWidth - EDGE))
  return { top, left, maxHeight: screen.height - top - EDGE }
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
    const place = placeMenu(trigger.current!.getBoundingClientRect(), menu.offsetWidth, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
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
