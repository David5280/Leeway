// Ask Leeway's pure pieces: each screen's name, which addresses in an
// answer are the app's own screens, the "/" key's rules, what a card is
// about, which presses outside the box keep their own focus, and the box
// kept on screen while it plays its way out.

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LINKABLE_SCREENS } from '../../../../server/src/lib/appPaths'
import { SCREEN_ROUTES } from '../../routes'
import { cardAbout } from './cardAbout'
import { slashKey } from './keys'
import { isAppLink, screenName } from './screens'
import { takesFocus } from './useOutsidePress'
import { usePresence } from './usePresence'

afterEach(() => {
  vi.useRealTimers()
})

describe('screenName', () => {
  it('names every screen the router answers, never falling back for one', () => {
    for (const path of Object.values(SCREEN_ROUTES)) {
      const address = path.replace(/\/:\w+\?/, '').replace(/:\w+/g, 'x')
      expect(screenName(address), address).not.toBe('Leeway')
    }
  })

  it('prefers a fixed address over one with an id', () => {
    expect(screenName('/spending/activity')).toBe('All activity')
    expect(screenName('/spending/over-time')).toBe('Spending over time')
    expect(screenName('/spending/merchants')).toBe('Top merchants')
    expect(screenName('/spending/c1')).toBe('Category')
    expect(screenName('/wealth/savings')).toBe('How much you save')
    expect(screenName('/wealth/compare')).toBe('Compare accounts')
    expect(screenName('/wealth/accounts/a1')).toBe('Account')
    expect(screenName('/settings')).toBe('Settings')
    expect(screenName('/nowhere')).toBe('Leeway')
  })
})

describe('isAppLink', () => {
  it('takes every screen the model is told it may link to', () => {
    for (const path of Object.values(LINKABLE_SCREENS)) expect(isAppLink(path), path).toBe(true)
  })

  it.each([
    'https://example.com/payday',
    '//example.com/payday',
    '/\\example.com',
    'javascript:alert(1)',
    'payday',
    '/not-a-screen',
    '/payday/bills/extra/deep',
  ])('refuses %s', (href) => {
    expect(isAppLink(href)).toBe(false)
  })

  it('reads the path alone, so a query still matches its screen', () => {
    expect(isAppLink('/spending/activity?merchant=Cafe')).toBe(true)
  })
})

describe('slashKey', () => {
  const press = (fields: Partial<KeyboardEvent> = {}) =>
    ({
      key: '/',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      defaultPrevented: false,
      target: document.body,
      ...fields,
    }) as KeyboardEvent

  it('is "/" alone, outside a field', () => {
    expect(slashKey(press())).toBe(true)
  })

  it('leaves fields, modifiers, other keys and handled presses alone', () => {
    expect(slashKey(press({ target: document.createElement('textarea') }))).toBe(false)
    expect(slashKey(press({ metaKey: true }))).toBe(false)
    expect(slashKey(press({ key: '?' }))).toBe(false)
    expect(slashKey(press({ defaultPrevented: true }))).toBe(false)
  })
})

describe('cardAbout', () => {
  const card = (html: string) => {
    const section = document.createElement('section')
    section.innerHTML = html
    return section
  }

  it('takes the label given, then the first amount shown', () => {
    const about = cardAbout(card('<span class="money">$1,180</span>'), 'Until payday')
    expect(about).toEqual({ label: 'Until payday', figure: '$1,180' })
  })

  it('reads the name shown, leaving out words only screen readers hear', () => {
    const about = cardAbout(
      card('<h2>Top goal<span class="visually-hidden">, open details</span></h2>'),
    )
    expect(about).toEqual({ label: 'Top goal' })
  })

  it('is nothing for a card with no name at all', () => {
    expect(cardAbout(card('<p>Just words</p>'))).toBeNull()
  })
})

describe('takesFocus', () => {
  /** An element made from markup, found by its id. */
  const element = (html: string, id: string) => {
    document.body.innerHTML = html
    return document.getElementById(id)
  }

  it('is true for a field, a link or a button, and for words inside one', () => {
    expect(takesFocus(element('<input id="x" />', 'x'))).toBe(true)
    expect(takesFocus(element('<a href="/goals"><span id="x">Goals</span></a>', 'x'))).toBe(true)
    expect(takesFocus(element('<button><svg id="x"></svg></button>', 'x'))).toBe(true)
  })

  it('is false for plain words, a disabled button, or nothing at all', () => {
    expect(takesFocus(element('<p id="x">Just words</p>', 'x'))).toBe(false)
    expect(takesFocus(element('<button disabled id="x">Off</button>', 'x'))).toBe(false)
    expect(takesFocus(null)).toBe(false)
  })
})

describe('usePresence', () => {
  it('draws at once on opening, and stays exitMs past closing, marked as leaving', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 140), {
      initialProps: { open: false },
    })
    expect(result.current).toEqual({ mounted: false, leaving: false })
    rerender({ open: true })
    expect(result.current).toEqual({ mounted: true, leaving: false })
    rerender({ open: false })
    expect(result.current).toEqual({ mounted: true, leaving: true })
    act(() => vi.advanceTimersByTime(139))
    expect(result.current.mounted).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toEqual({ mounted: false, leaving: false })
  })

  it('stays drawn, no longer leaving, when opened again on its way out', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 140), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    rerender({ open: true })
    act(() => vi.advanceTimersByTime(500))
    expect(result.current).toEqual({ mounted: true, leaving: false })
  })
})
