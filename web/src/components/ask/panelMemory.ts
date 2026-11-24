// Whether the computer's Ask Leeway panel was left open, kept per browser.
// Storage can be missing or refuse (a private window, blocked site data),
// so every read and write is guarded and the panel works without it.

const PANEL_KEY = 'leeway.askPanel'

/** Whether the panel was left open; closed when nothing was kept or storage is out of reach. */
export function readPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(PANEL_KEY) === 'open'
  } catch {
    return false
  }
}

/** Keeps the panel's state for next time, quietly doing nothing where storage refuses. */
export function writePanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed')
  } catch {
    // Storage is out of reach; the panel still works for this visit.
  }
}
