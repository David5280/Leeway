// Runs before every web test: DOM matchers, and a clean page after each test.

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom lays nothing out, so it has no scrolling; screens that scroll
// something into view get a no-op here, and tests that care spy on it.
Element.prototype.scrollIntoView = () => {}
// Nor does it track pointers; the sheet's swipe captures one, and its tests spy on this.
Element.prototype.setPointerCapture = () => {}

afterEach(() => {
  cleanup()
  // What one test leaves on this "device", like the Settings group opened last, goes with it.
  localStorage.clear()
})
