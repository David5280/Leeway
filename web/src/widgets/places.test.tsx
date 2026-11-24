// Home's cards in their tabs' colors: each widget whose figures belong to one
// tab carries that tab's place (styles/places.css colors its label, tint and
// chart from it), and widgets that mix tabs or only carry a status stay plain.

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { budgetFor, fakeServer, renderSignedIn } from '../test/fake'
import { Board } from './Board'
import { WIDGET_LIBRARY, type Widget, type WidgetType } from './library'

afterEach(() => vi.unstubAllGlobals())

/** The place each widget should wear: the tab it belongs to, or none. */
const EXPECTED: Record<WidgetType, string | null> = {
  summary: null,
  leeway: null,
  glance: null,
  alerts: null,
  flows: null,
  categories: 'spend',
  pace: 'spend',
  recent: 'spend',
  merchants: 'spend',
  trends: 'spend',
  'cash-flow': 'pay',
  bills: 'pay',
  goals: 'goal',
  accounts: 'wealth',
  debts: 'wealth',
  'net-worth': 'wealth',
}

const types = Object.keys(WIDGET_LIBRARY) as WidgetType[]

describe('the place of each Home widget', () => {
  it('names the tab each widget belongs to, Home itself never among them', () => {
    for (const type of types) {
      expect(WIDGET_LIBRARY[type]!.place ?? null, type).toBe(EXPECTED[type])
    }
  })

  it('carries onto the card, so it wears that tab’s color, and only there', () => {
    // Hidden, while editing: each widget's slot draws with its tools but
    // without its figures, so no data is needed to see where it belongs.
    const widgets: Widget[] = types.map((type) => ({ type, size: 'full', visible: false }))
    fakeServer({})
    renderSignedIn(
      <Board
        all={widgets}
        shown={widgets}
        editing
        budget={budgetFor([], [])}
        offset={0}
        save={() => {}}
      />,
    )
    for (const type of types) {
      const name = WIDGET_LIBRARY[type]!.name
      const slot = screen.getByText(name, { selector: '.widget-tools strong' }).closest('.widget')
      const place = EXPECTED[type]
      if (place) expect(slot, name).toHaveAttribute('data-place', place)
      else expect(slot, name).not.toHaveAttribute('data-place')
    }
  })
})
