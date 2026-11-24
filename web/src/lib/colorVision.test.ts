// The color-blindness check itself: Lab, the simulations and the distance,
// against known values (the reference checker's, to three places).

import { describe, expect, it } from 'vitest'
import { closestPair, colorDistance, simulate, toLab, VISIONS } from './colorVision'

describe('toLab', () => {
  it('puts white at full lightness and black at none, both without color', () => {
    const [l, a, b] = toLab([1, 1, 1])
    expect(l).toBeCloseTo(100, 1)
    expect(a).toBeCloseTo(0, 1)
    expect(b).toBeCloseTo(0, 1)
    expect(toLab([0, 0, 0])).toEqual([0, 0, 0])
  })

  it('places pure red where CIE Lab does', () => {
    const [l, a, b] = toLab(simulate('#FF0000', 'normal'))
    expect(l).toBeCloseTo(53.233, 2)
    expect(a).toBeCloseTo(80.109, 2)
    expect(b).toBeCloseTo(67.22, 2)
  })
})

describe('simulate', () => {
  it('leaves greys grey for every kind of vision, since none of them loses lightness', () => {
    for (const vision of VISIONS) {
      const [r, g, b] = simulate('#808080', vision)
      expect(g).toBeCloseTo(r, 2)
      expect(b).toBeCloseTo(r, 2)
    }
  })

  it('keeps every channel within what a screen can show', () => {
    for (const vision of VISIONS) {
      for (const channel of simulate('#00FFFF', vision)) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('colorDistance', () => {
  it('is nothing between a color and itself', () => {
    for (const vision of VISIONS) expect(colorDistance('#9980FE', '#9980FE', vision)).toBe(0)
  })

  it('matches the reference checker for a violet and a blue', () => {
    expect(colorDistance('#9980FE', '#98BFFE')).toBeCloseTo(46.25, 2)
    expect(colorDistance('#9980FE', '#98BFFE', 'protan')).toBeCloseTo(31.751, 2)
    expect(colorDistance('#9980FE', '#98BFFE', 'deutan')).toBeCloseTo(28.021, 2)
    expect(colorDistance('#9980FE', '#98BFFE', 'tritan')).toBeCloseTo(25.64, 2)
  })

  it('brings a green and a red close for red-green color blindness, but not for blue', () => {
    const [green, red] = ['#1B7A47', '#BA3127']
    expect(colorDistance(green, red)).toBeCloseTo(94.918, 2)
    expect(colorDistance(green, red, 'protan')).toBeCloseTo(12.642, 2)
    expect(colorDistance(green, red, 'deutan')).toBeCloseTo(26.011, 2)
    expect(colorDistance(green, red, 'tritan')).toBeCloseTo(106.782, 2)
  })
})

describe('closestPair', () => {
  it('names the pair, and the kind of vision, that come closest', () => {
    const closest = closestPair({ green: '#1B7A47', red: '#BA3127', blue: '#1F4FE0' })
    expect(closest.pair).toEqual(['green', 'red'])
    expect(closest.vision).toBe('protan')
    expect(closest.distance).toBeCloseTo(12.642, 2)
  })
})
