// The five tabs as data (tabs.ts): which tab a page lights, and which key
// presses switch tabs.

import { describe, expect, it } from 'vitest'
import { TABS, tabFor, tabKey } from './tabs'

/** A key press as the browser gives it, with nothing held and focus on the page. */
function press(key: string, more: Partial<Parameters<typeof tabKey>[0]> = {}) {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: document.body,
    ...more,
  }
}

describe('the tabs', () => {
  it('are the five questions, in order, each at its own address', () => {
    expect(TABS.map((tab) => [tab.label, tab.to])).toEqual([
      ['Home', '/'],
      ['Spending', '/spending'],
      ['Payday', '/payday'],
      ['Goals', '/goals'],
      ['Wealth', '/wealth'],
    ])
  })
})

describe('which tab a page lights', () => {
  it.each([
    ['/', 'Home'],
    ['/spending', 'Spending'],
    ['/spending/activity', 'Spending'],
    ['/spending/activity/import', 'Spending'],
    ['/spending/cat-1', 'Spending'],
    ['/payday', 'Payday'],
    ['/payday/bills', 'Payday'],
    ['/goals', 'Goals'],
    ['/goals/trips/2026-12-01/2026-12-05', 'Goals'],
    ['/wealth', 'Wealth'],
    ['/wealth/accounts/acct-1', 'Wealth'],
    ['/wealth/debts', 'Wealth'],
    ['/wealth/retirement', 'Wealth'],
    ['/wealth/idle-cash', 'Wealth'],
  ])('%s lights %s', (pathname, label) => {
    expect(tabFor(pathname)?.label).toBe(label)
  })

  it.each(['/inbox', '/alerts', '/settings', '/settings/banks', '/chat'])(
    '%s lights no tab',
    (pathname) => {
      expect(tabFor(pathname)).toBeUndefined()
    },
  )

  it('lights no tab for an address that only starts like one', () => {
    expect(tabFor('/spendingmore')).toBeUndefined()
    expect(tabFor('/goalsetting')).toBeUndefined()
  })
})

describe('the tab keys', () => {
  it.each([
    ['1', 'Home'],
    ['2', 'Spending'],
    ['3', 'Payday'],
    ['4', 'Goals'],
    ['5', 'Wealth'],
  ])('%s switches to %s', (key, label) => {
    expect(tabKey(press(key))?.label).toBe(label)
  })

  it.each(['0', '6', '9', 'a', '/', 'Enter', 'F1'])('leaves %s to the page', (key) => {
    expect(tabKey(press(key))).toBeUndefined()
  })

  it.each([
    ['Alt', { altKey: true }],
    ['Control', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Shift', { shiftKey: true }],
  ])('leaves a number to the browser with %s held', (_, held) => {
    expect(tabKey(press('2', held))).toBeUndefined()
  })

  it.each([
    ['a text field', () => document.createElement('input')],
    ['a text area', () => document.createElement('textarea')],
    ['a menu of choices', () => document.createElement('select')],
    [
      'editable text',
      () => {
        const editable = document.createElement('div')
        editable.contentEditable = 'true'
        // jsdom does not work out isContentEditable from the attribute itself.
        Object.defineProperty(editable, 'isContentEditable', { value: true })
        return editable
      },
    ],
  ])('types the number into %s instead', (_, field) => {
    expect(tabKey(press('2', { target: field() }))).toBeUndefined()
  })

  it('leaves a press the page already handled', () => {
    expect(tabKey(press('2', { defaultPrevented: true }))).toBeUndefined()
  })
})
