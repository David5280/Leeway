// What counts as the owner being busy, so a new build waits instead of
// reloading the page under them.

import { afterEach, describe, expect, it } from 'vitest'
import { holdReload, pageBusy } from './pageBusy'

afterEach(() => {
  document.body.replaceChildren()
  holdReload('ask', false)
})

/** Puts markup in the page and returns its first element. */
function place<T extends Element>(html: string): T {
  document.body.innerHTML = html
  return document.body.firstElementChild as T
}

describe('pageBusy', () => {
  it('is quiet on a page with nothing open, typed or held', () => {
    place('<main><button>Save</button><input type="checkbox" checked /></main>')
    expect(pageBusy()).toBe(false)
  })

  it('is busy while focus sits in a field, even an empty one', () => {
    place<HTMLInputElement>('<input type="text" />').focus()
    expect(pageBusy()).toBe(true)
  })

  it('is busy while a select has focus', () => {
    place<HTMLSelectElement>('<select><option>One</option></select>').focus()
    expect(pageBusy()).toBe(true)
  })

  it('is busy while any field holds typed text', () => {
    const field = place<HTMLTextAreaElement>('<textarea></textarea>')
    field.value = 'Half typed'
    expect(pageBusy()).toBe(true)
    field.value = '   '
    expect(pageBusy()).toBe(false)
  })

  it('is busy while a sheet or Ask Leeway is open', () => {
    place('<div role="dialog" aria-modal="true"><p>Edit</p></div>')
    expect(pageBusy()).toBe(true)
  })

  it('is busy while a part of the app holds a reload, until it lets go', () => {
    holdReload('ask', true)
    expect(pageBusy()).toBe(true)
    holdReload('ask', false)
    expect(pageBusy()).toBe(false)
  })
})
