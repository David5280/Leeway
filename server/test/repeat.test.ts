import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { repeatEvery } from '../src/lib/repeat.js'

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
