import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coalesced, repeatEvery } from '../src/lib/repeat.js'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('repeatEvery', () => {
  it('runs the task on every tick until stopped', async () => {
    const task = vi.fn(() => Promise.resolve())
    const stop = repeatEvery(1000, task, () => {})
    expect(task).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(task).toHaveBeenCalledTimes(3)
    stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('can run once right away', async () => {
    const task = vi.fn(() => Promise.resolve())
    const stop = repeatEvery(1000, task, () => {}, { runNow: true })
    expect(task).toHaveBeenCalledTimes(1)
    stop()
  })

  it('skips a tick while the last run is still going', async () => {
    let finish = () => {}
    const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const stop = repeatEvery(1000, task, () => {})
    await vi.advanceTimersByTimeAsync(3000)
    expect(task).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(1000)
    expect(task).toHaveBeenCalledTimes(2)
    stop()
  })

  it('reports a failure and keeps going', async () => {
    const onError = vi.fn()
    const task = vi.fn(() => Promise.reject(new Error('down')))
    const stop = repeatEvery(1000, task, onError)
    await vi.advanceTimersByTimeAsync(2000)
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls[0]![0]).toEqual(new Error('down'))
    stop()
  })
})

describe('coalesced', () => {
  it('runs once a moment after a burst of pulls', async () => {
    const task = vi.fn(() => Promise.resolve())
    const pull = coalesced(task, () => {}, 1000)
    pull()
    pull()
    await vi.advanceTimersByTimeAsync(500)
    pull()
    expect(task).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('runs once more after a run that was pulled while going, never two at once', async () => {
    let finish = () => {}
    const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const pull = coalesced(task, () => {}, 1000)
    pull()
    await vi.advanceTimersByTimeAsync(1000)
    pull()
    pull()
    await vi.advanceTimersByTimeAsync(5000)
    expect(task).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(1000)
    expect(task).toHaveBeenCalledTimes(2)
    finish()
    await vi.advanceTimersByTimeAsync(5000)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('reports a failure and still runs on the next pull', async () => {
    const onError = vi.fn()
    const task = vi.fn(() => Promise.reject(new Error('down')))
    const pull = coalesced(task, onError, 10)
    pull()
    await vi.advanceTimersByTimeAsync(10)
    expect(onError).toHaveBeenCalledWith(new Error('down'))
    pull()
    await vi.advanceTimersByTimeAsync(10)
    expect(task).toHaveBeenCalledTimes(2)
  })
})
