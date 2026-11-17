import { describe, expect, it } from 'vitest'
import {
  addableTypes,
  canMove,
  changeWidget,
  DEFAULT_LAYOUT,
  drawable,
  moveWidget,
  WIDGET_LIBRARY,
  type Widget,
} from './library'

// A widget type this build does not draw, as a newer Leeway or an agent might save.
const future = { type: 'forecast', size: 'half', visible: true } as unknown as Widget
const types = (widgets: Widget[]) => widgets.map((w) => w.type as string)

describe('the default layout', () => {
  it('only uses widgets this build can draw', () => {
    expect(drawable(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT)
  })
})

describe('drawable', () => {
  it('keeps the saved order and skips unknown widgets', () => {
    expect(types(drawable([DEFAULT_LAYOUT[1]!, future, DEFAULT_LAYOUT[0]!]))).toEqual([
      'glance',
      'leeway',
    ])
  })
})

describe('moveWidget', () => {
  it('swaps with the next widget', () => {
    expect(types(moveWidget(DEFAULT_LAYOUT, 0, 1)).slice(0, 2)).toEqual(['glance', 'leeway'])
  })

  it('returns the same list at either end', () => {
    expect(moveWidget(DEFAULT_LAYOUT, 0, -1)).toBe(DEFAULT_LAYOUT)
    expect(moveWidget(DEFAULT_LAYOUT, DEFAULT_LAYOUT.length - 1, 1)).toBe(DEFAULT_LAYOUT)
  })

  it('steps over widgets it cannot draw, keeping them in the list', () => {
    const saved = [DEFAULT_LAYOUT[0]!, future, DEFAULT_LAYOUT[1]!]
    expect(types(moveWidget(saved, 0, 1))).toEqual(['glance', 'forecast', 'leeway'])
    expect(types(moveWidget(saved, 2, -1))).toEqual(['glance', 'forecast', 'leeway'])
  })

  it('does not change the list it was given', () => {
    const saved = [...DEFAULT_LAYOUT]
    moveWidget(saved, 0, 1)
    expect(saved).toEqual(DEFAULT_LAYOUT)
  })
})

describe('canMove', () => {
  it('is false at the ends, counting only drawable widgets', () => {
    const saved = [future, DEFAULT_LAYOUT[0]!, DEFAULT_LAYOUT[1]!, future]
    expect(canMove(saved, 1, -1)).toBe(false)
    expect(canMove(saved, 1, 1)).toBe(true)
    expect(canMove(saved, 2, -1)).toBe(true)
    expect(canMove(saved, 2, 1)).toBe(false)
  })
})

describe('changeWidget', () => {
  it('changes only the widget of that type', () => {
    const next = changeWidget(DEFAULT_LAYOUT, 'glance', { visible: false, size: 'full' })
    expect(next[1]).toEqual({ type: 'glance', size: 'full', visible: false })
    expect(next.filter((w) => w.type !== 'glance')).toEqual(
      DEFAULT_LAYOUT.filter((w) => w.type !== 'glance'),
    )
  })
})

describe('addableTypes', () => {
  it('lists library widgets not on the dashboard, in library order', () => {
    expect(addableTypes(DEFAULT_LAYOUT)).toEqual([
      'merchants',
      'trends',
      'cash-flow',
      'bills',
      'goals',
      'debts',
      'net-worth',
    ])
  })

  it('offers everything for an empty dashboard', () => {
    expect(addableTypes([])).toEqual(Object.keys(WIDGET_LIBRARY))
  })
})
