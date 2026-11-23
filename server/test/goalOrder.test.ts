import { describe, expect, it } from 'vitest'
import { landingChanges, landings, moveId, type OrderedGoal } from '../src/domain/goalOrder.js'

const TODAY = '2026-11-21'

function goal(id: string, remainingCents: number, status: OrderedGoal['status'] = 'in_progress') {
  return { id, name: id, remainingCents, status }
}

const trip = goal('Trip', 120_000)
const car = goal('Car', 300_000)

describe('landings', () => {
  it('fills goals one after another from the monthly amount', () => {
    // $500 a month: the trip's $1,200 takes three months, then the car's $3,000 six more.
    const [first, second] = landings([trip, car], 50_000, TODAY)
    expect(first).toMatchObject({ landsOn: '2027-02-01', ifMovedUp: null })
    expect(second).toMatchObject({ landsOn: '2027-08-01' })
  })

  it('says what moving a goal up would cost the goal it passes', () => {
    const [, second] = landings([trip, car], 50_000, TODAY)
    expect(second!.ifMovedUp).toEqual({
      landsOn: '2027-05-01',
      passedId: 'Trip',
      passedName: 'Trip',
      passedLandsOn: '2027-08-01',
    })
  })

  it('passes reached and stale goals by, without spending the amount on them', () => {
    const done = goal('Done', 0, 'reached')
    const frozen = goal('Frozen', 50_000, 'stale')
    const result = landings([done, frozen, trip], 50_000, TODAY)
    expect(result.map((g) => g.landsOn)).toEqual([null, null, '2027-02-01'])
    // Nothing to weigh against a goal that is not being saved for.
    expect(result[2]!.ifMovedUp).toBeNull()
  })

  it('counts a past-due goal as still being saved for', () => {
    const late = goal('Late', 50_000, 'past_due')
    expect(landings([late], 50_000, TODAY)[0]!.landsOn).toBe('2026-12-01')
  })

  it('gives no dates without a monthly amount, or past fifty years', () => {
    expect(landings([trip, car], 0, TODAY).map((g) => g.landsOn)).toEqual([null, null])
    expect(landings([trip, car], 0, TODAY)[1]!.ifMovedUp).toBeNull()
    expect(landings([goal('Castle', 1_000_000_000)], 100, TODAY)[0]!.landsOn).toBeNull()
  })
})

describe('landingChanges and moveId', () => {
  it('lists the goals whose month moved, in the new order', () => {
    const before = landings([trip, car], 50_000, TODAY)
    const after = landings([car, trip], 50_000, TODAY)
    expect(landingChanges(before, after)).toEqual([
      { id: 'Car', name: 'Car', from: '2027-08-01', to: '2027-05-01' },
      { id: 'Trip', name: 'Trip', from: '2027-02-01', to: '2027-08-01' },
    ])
    expect(landingChanges(before, before)).toEqual([])
  })

  it('moves an id one place up or down, and leaves the list as it is at either end', () => {
    const ids = ['a', 'b', 'c']
    expect(moveId(ids, 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveId(ids, 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveId(ids, 0, -1)).toBe(ids)
    expect(moveId(ids, 2, 1)).toBe(ids)
  })
})
