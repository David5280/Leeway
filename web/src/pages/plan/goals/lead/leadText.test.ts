// Which goal lands next, and what the lead says when none can.

import { describe, expect, it } from 'vitest'
import { car, laptop, orderOf, trip } from '../../../../test/goalOrder'
import { nextToLand, noLandingText } from './leadText'

describe('the goal next to land', () => {
  it('is the soonest landing month in the order', () => {
    expect(nextToLand(orderOf([trip, car, laptop]))?.name).toBe('Trip')
    expect(nextToLand(orderOf([laptop, trip]))?.name).toBe('Laptop')
  })

  it('is nothing while no goal has a month to land in', () => {
    expect(nextToLand(orderOf([trip], 0, 'none'))).toBeNull()
    expect(nextToLand(orderOf([]))).toBeNull()
  })

  it('says why there is none, with goals and without', () => {
    expect(noLandingText(orderOf([]))).toBe(
      'No goals yet. Start one below, and the next to land shows here.',
    )
    expect(noLandingText(orderOf([trip], 0, 'none'))).toBe(
      'No goal has a date to land yet. Put money toward one and it shows here.',
    )
  })
})
