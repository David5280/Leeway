import { act, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountUp } from '../components/design/CountUp'
import { fakeServer, renderSignedIn } from '../test/fake'
import { countAt, easeOutCubic, useCountUp, useReducedMotion } from './motion'

/**
 * A device whose reduced-motion setting is `reduce`, which can be changed
 * later as the system setting would be, telling whoever listens.
 */
function fakeMotionSetting(reduce: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: reduce,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', () => media)
  return {
    listeners,
    change(next: boolean) {
      media.matches = next
      listeners.forEach((listener) => listener())
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('easeOutCubic and countAt', () => {
  it('moves fast at first and settles onto the value', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(0.5)).toBe(0.875)
    expect(easeOutCubic(1)).toBe(1)
    // Outside 0 to 1 it holds at the ends.
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })

  it('rounds the count to whole cents, and lands on the value when time is up', () => {
    expect(countAt(0, 1000, 350, 700)).toBe(875)
    expect(countAt(500, 1000, 700, 700)).toBe(1000)
    expect(countAt(0, 1000, 10, 0)).toBe(1000)
  })
})

describe('useReducedMotion', () => {
  it('leaves motion out when the device cannot say, as in tests', () => {
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('follows the device setting as it changes, and stops listening when gone', () => {
    const setting = fakeMotionSetting(false)
    const { result, unmount } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => setting.change(true))
    expect(result.current).toBe(true)
    unmount()
    expect(setting.listeners.size).toBe(0)
  })
})

describe('useCountUp', () => {
  it('is the value straight away when less motion is asked for', () => {
    fakeMotionSetting(true)
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 1000 },
    })
    expect(result.current).toBe(1000)
    rerender({ target: 2000 })
    expect(result.current).toBe(2000)
  })

  it('counts from zero to the value, one frame at a time, then from there to a new one', () => {
    fakeMotionSetting(false)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 700), {
      initialProps: { target: 1000 },
    })
    expect(result.current).toBe(0)
    act(() => vi.advanceTimersByTime(350))
    expect(result.current).toBeGreaterThan(500)
    expect(result.current).toBeLessThan(1000)
    act(() => vi.advanceTimersByTime(400))
    expect(result.current).toBe(1000)

    rerender({ target: 400 })
    act(() => vi.advanceTimersByTime(800))
    expect(result.current).toBe(400)
  })

  it('stops counting when it leaves the screen', () => {
    fakeMotionSetting(false)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { unmount } = renderHook(() => useCountUp(1000))
    unmount()
    expect(cancel).toHaveBeenCalled()
  })
})

describe('CountUp', () => {
  function renderCount(cents: number) {
    fakeServer({})
    return renderSignedIn(<CountUp cents={cents} />)
  }

  it('is plain money with less motion asked for', () => {
    renderCount(123400)
    expect(screen.getByText('$1,234')).toBeInTheDocument()
    expect(document.querySelector('.count-up')).toBeNull()
  })

  it('reads only the final amount aloud while the shown copy counts', () => {
    fakeMotionSetting(false)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    renderCount(123400)
    const counting = document.querySelector('.count-up')!
    expect(counting.querySelector('.visually-hidden')).toHaveTextContent('$1,234')
    expect(counting.querySelector('[aria-hidden="true"]')).toHaveTextContent('$0')
    act(() => vi.advanceTimersByTime(1000))
    expect(document.querySelector('.count-up')).toBeNull()
    expect(screen.getByText('$1,234')).toBeInTheDocument()
  })
})
