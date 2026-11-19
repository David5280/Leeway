import { describe, expect, it } from 'vitest'
import { AttemptLimiter } from '../src/lib/attemptLimiter.js'

describe('AttemptLimiter', () => {
  function limiterAt(start: number) {
    let now = start
    const limiter = new AttemptLimiter({ maxAttempts: 3, windowMs: 1000, now: () => now })
    return { limiter, advance: (ms: number) => (now += ms) }
  }

  it('allows attempts until the attempts fill the window', () => {
    const { limiter, advance } = limiterAt(0)
    limiter.record()
    advance(100)
    limiter.record()
    expect(limiter.waitMs()).toBe(0)

    advance(100)
    limiter.record()

    // The first attempt, at 0, leaves the window at 1000; it is now 200.
    expect(limiter.waitMs()).toBe(800)
  })

  it('lets attempts through again as old attempts leave the window', () => {
    const { limiter, advance } = limiterAt(5000)
    for (let i = 0; i < 3; i++) limiter.record()
    advance(999)
    expect(limiter.waitMs()).toBe(1)
    advance(1)
    expect(limiter.waitMs()).toBe(0)
  })

  it('uses the real clock when none is given', () => {
    const limiter = new AttemptLimiter({ maxAttempts: 1, windowMs: 60_000 })
    expect(limiter.waitMs()).toBe(0)
    limiter.record()
    expect(limiter.waitMs()).toBeGreaterThan(59_000)
  })
})
