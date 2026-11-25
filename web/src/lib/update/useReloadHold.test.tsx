// A part of the app holds off a reload only while it is mid-task.

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { pageBusy } from './pageBusy'
import { useReloadHold } from './useReloadHold'

describe('useReloadHold', () => {
  it('holds while true and lets go when false', () => {
    const { rerender, unmount } = renderHook(({ holding }) => useReloadHold(holding), {
      initialProps: { holding: true },
    })
    expect(pageBusy()).toBe(true)
    rerender({ holding: false })
    expect(pageBusy()).toBe(false)
    unmount()
  })

  it('lets go when the part unmounts', () => {
    const { unmount } = renderHook(() => useReloadHold(true))
    unmount()
    expect(pageBusy()).toBe(false)
  })

  it('keeps one part holding when another lets go', () => {
    const busy = renderHook(() => useReloadHold(true))
    const idle = renderHook(() => useReloadHold(false))
    idle.unmount()
    expect(pageBusy()).toBe(true)
    busy.unmount()
    expect(pageBusy()).toBe(false)
  })
})
