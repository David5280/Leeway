import { describe, expect, it } from 'vitest'
import { DEFAULT_WIDGETS } from '../../../server/src/domain/settings'
import {
  addableTypes,
  canMove,
  changeWidget,
  DEFAULT_LAYOUT,
  DEPTHS,
  drawable,
  moveWidget,
  readsGeneralFirst,
  urgentFirst,
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

  it("is the server's default", () => {
    expect(DEFAULT_LAYOUT).toEqual(DEFAULT_WIDGETS)
  })

  it('reads from the most general answer down to the most detail, on a phone too', () => {
    expect(readsGeneralFirst(DEFAULT_LAYOUT)).toBe(true)
    expect(DEFAULT_LAYOUT[0]!.type).toBe('leeway')
    for (const entry of Object.values(WIDGET_LIBRARY)) expect(DEPTHS).toContain(entry!.depth)
  })

  it('keeps to what answers "am I OK?", leaving the rest to add or to their own pages', () => {
    expect(types(DEFAULT_LAYOUT)).toEqual(['leeway', 'net-worth', 'alerts', 'flows', 'pace'])
  })

  it('catches a detailed card placed above a general one', () => {
    const [leeway, netWorth, alerts, ...rest] = DEFAULT_LAYOUT
    expect(readsGeneralFirst([alerts!, leeway!, netWorth!, ...rest])).toBe(false)
    expect(readsGeneralFirst([leeway!, netWorth!, ...rest, alerts!])).toBe(false)
    // Side by side on a computer, a phone still stacks the half widget under the wide one.
    const recentBesideLeeway = [leeway!, { type: 'recent', size: 'half', visible: true } as Widget]
    expect(readsGeneralFirst(recentBesideLeeway)).toBe(true)
    expect(
      readsGeneralFirst([
        { ...recentBesideLeeway[1]!, size: 'wide' },
        { ...leeway!, size: 'half' },
      ]),
    ).toBe(false)
  })
})

describe('drawable', () => {
  it('keeps the saved order and skips unknown widgets', () => {
    expect(types(drawable([w('glance', 'half'), future, w('leeway', 'wide')]))).toEqual([
      'glance',
      'leeway',
    ])
  })
})

/** A widget of a type and size, shown. */
const w = (type: string, size: Widget['size']) => ({ type, size, visible: true }) as Widget

describe('moveWidget', () => {
  it('swaps with the next widget in the same column', () => {
    const saved = [w('leeway', 'wide'), w('glance', 'half'), w('recent', 'wide')]
    expect(types(moveWidget(saved, 0, 1))).toEqual(['recent', 'glance', 'leeway'])
    expect(types(moveWidget(saved, 2, -1))).toEqual(['recent', 'glance', 'leeway'])
  })

  it('swaps past a full widget, which every column crosses', () => {
    const saved = [w('leeway', 'wide'), w('glance', 'half'), w('alerts', 'full')]
    expect(types(moveWidget(saved, 1, 1))).toEqual(['leeway', 'alerts', 'glance'])
    expect(types(moveWidget(saved, 2, -1))).toEqual(['leeway', 'alerts', 'glance'])
  })

  it('returns the same list at either end', () => {
    expect(moveWidget(DEFAULT_LAYOUT, 0, -1)).toBe(DEFAULT_LAYOUT)
    expect(moveWidget(DEFAULT_LAYOUT, DEFAULT_LAYOUT.length - 1, 1)).toBe(DEFAULT_LAYOUT)
  })

  it('steps over widgets it cannot draw, keeping them in the list', () => {
    const saved = [w('leeway', 'wide'), future, w('recent', 'wide')]
    expect(types(moveWidget(saved, 0, 1))).toEqual(['recent', 'forecast', 'leeway'])
    expect(types(moveWidget(saved, 2, -1))).toEqual(['recent', 'forecast', 'leeway'])
  })

  it('steps over widgets in the other column, since swapping with them changes nothing on screen', () => {
    const saved = [w('categories', 'wide'), w('pace', 'half'), w('recent', 'wide')]
    expect(types(moveWidget(saved, 0, 1))).toEqual(['recent', 'pace', 'categories'])
    // The half widget has nothing in its own column to swap with.
    expect(moveWidget(saved, 1, -1)).toBe(saved)
  })

  it('does not change the list it was given', () => {
    const saved = [...DEFAULT_LAYOUT]
    moveWidget(saved, 0, 1)
    expect(saved).toEqual(DEFAULT_LAYOUT)
  })
})

describe('canMove', () => {
  it('is false at the ends of a column, counting only drawable widgets', () => {
    const saved = [future, w('leeway', 'wide'), w('glance', 'half'), w('alerts', 'full'), future]
    expect(canMove(saved, 1, -1)).toBe(false)
    expect(canMove(saved, 1, 1)).toBe(true)
    expect(canMove(saved, 2, -1)).toBe(false)
    expect(canMove(saved, 2, 1)).toBe(true)
    expect(canMove(saved, 3, -1)).toBe(true)
    expect(canMove(saved, 3, 1)).toBe(false)
  })
})

describe('changeWidget', () => {
  it('changes only the widget of that type', () => {
    const next = changeWidget(DEFAULT_LAYOUT, 'pace', { visible: false, size: 'half' })
    expect(next.find((w) => w.type === 'pace')).toEqual({
      type: 'pace',
      size: 'half',
      visible: false,
    })
    expect(next.filter((w) => w.type !== 'pace')).toEqual(
      DEFAULT_LAYOUT.filter((w) => w.type !== 'pace'),
    )
  })
})

describe('addableTypes', () => {
  it('lists library widgets not on the dashboard, in library order', () => {
    expect(addableTypes(DEFAULT_LAYOUT)).toEqual([
      'summary',
      'glance',
      'categories',
      'recent',
      'accounts',
      'merchants',
      'trends',
      'cash-flow',
      'bills',
      'goals',
      'debts',
    ])
  })

  it('offers everything for an empty dashboard', () => {
    expect(addableTypes([])).toEqual(Object.keys(WIDGET_LIBRARY))
  })
})

describe('urgentFirst', () => {
  const at = (...list: Widget['type'][]) =>
    list.map((type): Widget => ({ type, size: type === 'leeway' ? 'wide' : 'half', visible: true }))

  it('moves Heads up to just under the hero, full width, and moves nothing else', () => {
    const moved = urgentFirst(DEFAULT_LAYOUT)
    expect(types(moved)).toEqual(['leeway', 'alerts', 'net-worth', 'flows', 'pace'])
    expect(moved.find((w) => w.type === 'alerts')!.size).toBe('full')
    expect(types(urgentFirst(at('leeway', 'pace', 'recent', 'alerts')))).toEqual([
      'leeway',
      'alerts',
      'pace',
      'recent',
    ])
  })

  it('never moves Heads up down, and leads with it when no hero is shown', () => {
    expect(types(urgentFirst(at('alerts', 'pace', 'leeway')))).toEqual(['alerts', 'pace', 'leeway'])
    expect(types(urgentFirst(at('pace', 'recent', 'alerts')))).toEqual(['alerts', 'pace', 'recent'])
  })

  it('leaves a layout without Heads up as it is', () => {
    const list = at('leeway', 'pace')
    expect(urgentFirst(list)).toBe(list)
  })
})
