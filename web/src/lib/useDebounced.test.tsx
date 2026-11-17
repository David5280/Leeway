import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebounced } from './useDebounced'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebounced', () => {
  it('waits for the value to stop changing', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 100), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'ab' })
    act(() => vi.advanceTimersByTime(60))
    rerender({ value: 'abc' })
    act(() => vi.advanceTimersByTime(60))
    expect(result.current).toBe('a')
    act(() => vi.advanceTimersByTime(40))
    expect(result.current).toBe('abc')
  })

  it('treats a fresh object with the same content as unchanged', () => {
    let renders = 0
    const { result, rerender } = renderHook(
      ({ text }) => {
        renders += 1
        return useDebounced({ text }, 100)
      },
      { initialProps: { text: 'a' } },
    )
    const first = result.current
    rerender({ text: 'a' })
    act(() => vi.advanceTimersByTime(500))
    // Same content keeps the same object, and nothing keeps re-rendering.
    expect(result.current).toBe(first)
    expect(renders).toBe(2)
  })

  it('settles on the newest object once its content changes', () => {
    const { result, rerender } = renderHook(({ text }) => useDebounced({ text }, 100), {
      initialProps: { text: 'a' },
    })
    rerender({ text: 'b' })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toEqual({ text: 'b' })
  })
})
