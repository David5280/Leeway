// Ask Leeway's pure pieces: each screen's name, which addresses in an
// answer are the app's own screens, the "/" key's rules, what a card is
// about, and the panel remembered without storage.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { LINKABLE_SCREENS } from '../../../../server/src/lib/appPaths'
import { SCREEN_ROUTES } from '../../routes'
import { cardAbout } from './cardAbout'
import { slashKey } from './keys'
import { readPanelOpen, writePanelOpen } from './panelMemory'
import { isAppLink, screenName } from './screens'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
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
    expect(screenName('/spending/c1')).toBe('Category')
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

describe('the panel remembered', () => {
  it('is closed until left open, then open', () => {
    expect(readPanelOpen()).toBe(false)
    writePanelOpen(true)
    expect(readPanelOpen()).toBe(true)
  })

  it('is closed, quietly, when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writePanelOpen(true)).not.toThrow()
    expect(readPanelOpen()).toBe(false)
  })
})
