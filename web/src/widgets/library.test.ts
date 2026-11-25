import { describe, expect, it } from 'vitest'
import { DEFAULT_WIDGETS } from '../../../server/src/domain/settings'
import {
  addableTypes,
  canMove,
  changeWidget,
  DEFAULT_LAYOUT,
  drawable,
  moveWidget,
  WIDGET_LIBRARY,
  type Widget,
  type WidgetType,
} from './library'

const types = (widgets: Widget[]) => widgets.map((w) => w.type as string)
const w = (type: WidgetType, size: Widget['size']): Widget => ({ type, size, visible: true })

describe('the default layout', () => {
  it("is the server's default", () => {
    expect(DEFAULT_LAYOUT).toEqual(DEFAULT_WIDGETS)
  })

  it('follows the map: Leeway, Heads up, the accounts, bills, activity, then the tab row', () => {
    expect(types(DEFAULT_LAYOUT)).toEqual([
      'leeway',
      'alerts',
      'account-list',
      'coming-up',
      'latest-activity',
      'tab-row',
    ])
  })

  it('puts the accounts beside the bills and activity on a wide screen, the tab row under them', () => {
    expect(drawable(DEFAULT_LAYOUT).map((widget) => [widget.type, widget.size])).toEqual([
      ['account-list', 'wide'],
      ['coming-up', 'half'],
      ['latest-activity', 'half'],
      ['tab-row', 'full'],
    ])
  })

  it('colors the bills as Payday and the activity as Spending; the accounts and the row stay plain', () => {
    const places = drawable(DEFAULT_LAYOUT).map((widget) => WIDGET_LIBRARY[widget.type]!.place)
    expect(places).toEqual([undefined, 'pay', 'spend', undefined])
  })
})

describe('Leeway and Heads up', () => {
  it('are never in the library, so the layout tools cannot hide, move or add them', () => {
    expect(WIDGET_LIBRARY.leeway).toBeUndefined()
    expect(WIDGET_LIBRARY.alerts).toBeUndefined()
    expect(types(drawable(DEFAULT_LAYOUT))).not.toContain('leeway')
    expect(addableTypes([])).not.toContain('alerts')
  })

  it('are stepped over when a card moves, keeping their place in the saved list', () => {
    const saved = [w('pace', 'half'), w('leeway', 'half'), w('alerts', 'half'), w('goals', 'half')]
    expect(types(moveWidget(saved, 0, 1))).toEqual(['goals', 'leeway', 'alerts', 'pace'])
    expect(canMove(saved, 3, 1)).toBe(false)
    expect(canMove(saved, 0, -1)).toBe(false)
  })
})

describe('drawable', () => {
  it('keeps the saved order and skips the fixed cards', () => {
    const saved = [w('goals', 'half'), w('alerts', 'full'), w('leeway', 'wide'), w('pace', 'full')]
    expect(types(drawable(saved))).toEqual(['goals', 'pace'])
  })
})

describe('moveWidget', () => {
  it('swaps past a full card, which every column crosses', () => {
    const saved = [w('pace', 'wide'), w('goals', 'half'), w('net-worth', 'full')]
    expect(types(moveWidget(saved, 1, 1))).toEqual(['pace', 'net-worth', 'goals'])
    expect(types(moveWidget(saved, 2, -1))).toEqual(['pace', 'net-worth', 'goals'])
  })

  it('returns the same list at either end', () => {
    expect(moveWidget(DEFAULT_LAYOUT, 2, -1)).toBe(DEFAULT_LAYOUT)
    expect(moveWidget(DEFAULT_LAYOUT, DEFAULT_LAYOUT.length - 1, 1)).toBe(DEFAULT_LAYOUT)
  })

  it('steps over cards in the other column, since swapping with them changes nothing on screen', () => {
    const saved = [w('pace', 'wide'), w('goals', 'half'), w('net-worth', 'wide')]
    expect(types(moveWidget(saved, 0, 1))).toEqual(['net-worth', 'goals', 'pace'])
  })

  it('does not change the list it was given', () => {
    const saved = [...DEFAULT_LAYOUT]
    moveWidget(saved, 2, 1)
    expect(saved).toEqual(DEFAULT_LAYOUT)
  })
})

describe('changeWidget', () => {
  it('changes only the card of that type', () => {
    const next = changeWidget(DEFAULT_LAYOUT, 'coming-up', { visible: false, size: 'full' })
    expect(next.find((widget) => widget.type === 'coming-up')).toEqual({
      type: 'coming-up',
      size: 'full',
      visible: false,
    })
    expect(next.filter((widget) => widget.type !== 'coming-up')).toEqual(
      DEFAULT_LAYOUT.filter((widget) => widget.type !== 'coming-up'),
    )
  })
})

describe('addableTypes', () => {
  it('lists library cards not on Home, in library order, leaving out what the tab row shows', () => {
    expect(addableTypes(DEFAULT_LAYOUT)).toEqual(['summary', 'trends', 'merchants', 'debts'])
  })

  it('offers each tab card on its own once the tab row is gone', () => {
    const withoutRow = DEFAULT_LAYOUT.filter((widget) => widget.type !== 'tab-row')
    expect(addableTypes(withoutRow)).toEqual([
      'tab-row',
      'cash-flow',
      'pace',
      'goals',
      'net-worth',
      'summary',
      'trends',
      'merchants',
      'debts',
    ])
  })

  it('offers no tab row while a tab card is on Home on its own, so no figure shows twice', () => {
    const mapOrder = [w('leeway', 'wide'), w('alerts', 'full'), w('pace', 'half')]
    const offered = addableTypes(mapOrder)
    expect(offered).not.toContain('tab-row')
    expect(offered).toEqual(expect.arrayContaining(['account-list', 'cash-flow', 'goals']))
  })

  it('offers every library card for an empty Home', () => {
    expect(addableTypes([])).toEqual(Object.keys(WIDGET_LIBRARY))
  })
})
