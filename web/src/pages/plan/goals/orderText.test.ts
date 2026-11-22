import { describe, expect, it } from 'vitest'
import {
  changesText,
  firstTradeOff,
  landingText,
  moveUpText,
  orderBars,
  orderKey,
  type Landing,
} from './orderText'

/** A goal in the order, still being saved for, landing on the day given. */
function landing(name: string, landsOn: string | null, extra: Partial<Landing> = {}): Landing {
  return {
    id: name,
    name,
    remainingCents: 100_000,
    status: 'in_progress',
    landsOn,
    ifMovedUp: null,
    ...extra,
  }
}

describe('when a goal lands', () => {
  it('says the month, or why there is none', () => {
    expect(landingText(landing('Trip', '2027-03-01'), 'en-US')).toBe('Lands Mar 2027')
    expect(landingText(landing('Trip', null), 'en-US')).toBe('No date yet')
    expect(landingText(landing('Trip', null, { status: 'reached' }), 'en-US')).toBe('Reached')
    expect(landingText(landing('Trip', null, { status: 'stale' }), 'en-US')).toBe(
      'Waiting on its account',
    )
  })
})

describe('the trade-off of moving a goal up', () => {
  const car = landing('Car', '2027-08-01', {
    ifMovedUp: {
      landsOn: '2027-05-01',
      passedId: 'Trip',
      passedName: 'Trip',
      passedLandsOn: '2027-10-01',
    },
  })

  it('names both goals and both new months', () => {
    expect(moveUpText(car, 'en-US')).toBe(
      'Moving Car ahead of Trip lands it in May 2027 and pushes Trip to Oct 2027.',
    )
  })

  it('says nothing for the first goal, or when a date is not known', () => {
    expect(moveUpText(landing('Trip', '2027-03-01'), 'en-US')).toBeNull()
    const unknown = { ...car, ifMovedUp: { ...car.ifMovedUp!, passedLandsOn: null } }
    expect(moveUpText(unknown, 'en-US')).toBeNull()
  })
})

describe('what a move did', () => {
  it('says each new month in one line', () => {
    const changes = [
      { id: 'c', name: 'Car', from: '2027-08-01', to: '2027-05-01' },
      { id: 't', name: 'Trip', from: '2027-03-01', to: '2027-10-01' },
    ]
    expect(changesText(changes, 'en-US')).toBe('Car now lands May 2027. Trip now lands Oct 2027.')
  })

  it('leaves out a goal that lost its date, and says nothing when no date moved', () => {
    expect(changesText([{ id: 'c', name: 'Car', from: '2027-08-01', to: null }], 'en-US')).toBe(
      null,
    )
    expect(changesText([], 'en-US')).toBeNull()
  })
})

describe('the timeline bars', () => {
  it('lays goals end to end from today to the last landing', () => {
    const bars = orderBars(
      [landing('Trip', '2027-01-01'), landing('Car', '2027-11-01')],
      '2026-11-01',
    )
    expect(bars[0]).toEqual({ startPercent: 0, endPercent: 17 })
    expect(bars[1]).toEqual({ startPercent: 17, endPercent: 100 })
  })

  it('gives a goal reached the same month a sliver at the right edge, and none with no date', () => {
    const bars = orderBars(
      [landing('Trip', '2027-01-01'), landing('Gift', '2027-01-01'), landing('Car', null)],
      '2026-11-01',
    )
    expect(bars[0]).toEqual({ startPercent: 0, endPercent: 100 })
    expect(bars[1]).toEqual({ startPercent: 98, endPercent: 100 })
    expect(bars[2]).toBeNull()
  })

  it('gives a goal reached the same month a sliver after the one before, where there is room', () => {
    const bars = orderBars(
      [landing('Trip', '2027-01-01'), landing('Gift', '2027-01-01'), landing('Car', '2027-11-01')],
      '2026-11-01',
    )
    expect(bars[1]).toEqual({ startPercent: 17, endPercent: 19 })
    expect(bars[2]).toEqual({ startPercent: 19, endPercent: 100 })
  })

  it('draws nothing when no goal has a date', () => {
    expect(orderBars([landing('Trip', null)], '2026-11-01')).toEqual([null])
  })
})

describe('the trade-off said first', () => {
  const passed = { passedId: 'Trip', passedName: 'Trip', passedLandsOn: '2027-08-01' }

  it('skips goals with nothing to weigh, down to the first that has one', () => {
    const goals = [
      landing('Trip', '2027-03-01'),
      landing('Gift', null, { status: 'reached' }),
      landing('Car', '2027-08-01', { ifMovedUp: { landsOn: '2027-05-01', ...passed } }),
    ]
    expect(firstTradeOff(goals, 'en-US')).toBe(
      'Moving Car ahead of Trip lands it in May 2027 and pushes Trip to Aug 2027.',
    )
  })

  it('says nothing when no move has one', () => {
    expect(firstTradeOff([landing('Trip', null)], 'en-US')).toBeNull()
  })
})

describe('what an order says', () => {
  const order = (monthlyCents: number, carLands: string) => ({
    monthlyCents,
    source: 'entered' as const,
    goals: [landing('Trip', '2027-03-01'), landing('Car', carLands)],
  })

  it('reads the same for the same amount, places and months', () => {
    expect(orderKey(order(50_000, '2027-08-01'))).toBe(orderKey(order(50_000, '2027-08-01')))
  })

  it('changes with the amount or a month', () => {
    const key = orderKey(order(50_000, '2027-08-01'))
    expect(orderKey(order(60_000, '2027-08-01'))).not.toBe(key)
    expect(orderKey(order(50_000, '2027-09-01'))).not.toBe(key)
  })
})
