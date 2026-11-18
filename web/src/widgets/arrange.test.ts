import { describe, expect, it } from 'vitest'
import { arrange, sharesLane, type Band } from './arrange'
import { DEFAULT_LAYOUT, type Widget } from './library'

const w = (type: string, size: Widget['size']) => ({ type, size, visible: true }) as Widget

/** A band as plain type names, easy to compare. */
function names(band: Band) {
  if (band.kind === 'full') return { full: band.widget.type }
  if (band.kind === 'split') {
    return { main: band.main.map((x) => x.type), side: band.side.map((x) => x.type) }
  }
  return { pair: band.columns.map((column) => column.map((x) => x.type)) }
}

describe('arrange', () => {
  it('lays the default dashboard out as main and side columns around the alerts', () => {
    expect(arrange(DEFAULT_LAYOUT).map(names)).toEqual([
      { main: ['leeway'], side: ['glance'] },
      { full: 'alerts' },
      { main: ['categories', 'recent'], side: ['pace', 'accounts'] },
    ])
  })

  it('gives a lone wide or half widget the full width rather than an empty column beside it', () => {
    expect(arrange([w('leeway', 'wide')]).map(names)).toEqual([{ full: 'leeway' }])
    expect(arrange([w('glance', 'half'), w('alerts', 'full')]).map(names)).toEqual([
      { full: 'glance' },
      { full: 'alerts' },
    ])
  })

  it('stacks wide widgets full width when no half widget shares their band', () => {
    expect(arrange([w('leeway', 'wide'), w('recent', 'wide')]).map(names)).toEqual([
      { full: 'leeway' },
      { full: 'recent' },
    ])
  })

  it('splits half widgets alone into two even columns, alternating in order', () => {
    const halves = ['bills', 'goals', 'debts'].map((type) => w(type, 'half'))
    expect(arrange(halves).map(names)).toEqual([{ pair: [['bills', 'debts'], ['goals']] }])
  })

  it('starts a new band after each full widget', () => {
    const saved = [
      w('alerts', 'full'),
      w('leeway', 'wide'),
      w('glance', 'half'),
      w('trends', 'full'),
      w('recent', 'wide'),
    ]
    expect(arrange(saved).map(names)).toEqual([
      { full: 'alerts' },
      { main: ['leeway'], side: ['glance'] },
      { full: 'trends' },
      { full: 'recent' },
    ])
  })

  it('draws nothing for an empty dashboard', () => {
    expect(arrange([])).toEqual([])
  })
})

describe('sharesLane', () => {
  it('pairs widgets of one size, and full widgets with every size', () => {
    expect(sharesLane(w('a', 'wide'), w('b', 'wide'))).toBe(true)
    expect(sharesLane(w('a', 'half'), w('b', 'half'))).toBe(true)
    expect(sharesLane(w('a', 'wide'), w('b', 'half'))).toBe(false)
    expect(sharesLane(w('a', 'full'), w('b', 'half'))).toBe(true)
    expect(sharesLane(w('a', 'wide'), w('b', 'full'))).toBe(true)
  })
})
