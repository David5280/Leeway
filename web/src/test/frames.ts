// A window of a given size for tests, as the shell's media queries see it
// (components/shell/frame.ts): a phone, a phone turned sideways, a tablet
// or a computer, resizable mid-test.

import { act } from '@testing-library/react'
import { vi } from 'vitest'
import { SHORT_QUERY, SIDEBAR_QUERY } from '../components/shell/frame'

/** The window's size, as the media queries the shell asks about see it. */
export interface Size {
  width: number
  height: number
}

/** Whether each query the shell asks matches a window of this size. */
function matches(query: string, { width, height }: Size): boolean {
  if (query === SIDEBAR_QUERY) return width >= 1024
  if (query === SHORT_QUERY) return width > height && height <= 500 && width >= 560
  throw new Error(`The shell asked an unexpected query: ${query}`)
}

/**
 * Stands in for the browser's matchMedia at a window size. Returns a resize,
 * which tells every listening query that the size changed, as a browser does.
 */
export function windowOf(size: Size) {
  let current = size
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches(query, current)
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  return (next: Size) =>
    act(() => {
      current = next
      for (const listener of listeners) listener()
    })
}

export const PHONE = { width: 390, height: 844 }
export const PHONE_SIDEWAYS = { width: 844, height: 390 }
export const TABLET = { width: 820, height: 1180 }
export const COMPUTER = { width: 1440, height: 900 }
