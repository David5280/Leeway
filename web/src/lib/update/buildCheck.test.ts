// The build check with a fake server, clock and page: no reload while the
// build is unchanged, one reload when it changes, and none while the owner is busy.

import { describe, expect, it, vi } from 'vitest'
import { CHECK_GAP_MS, createBuildCheck } from './buildCheck'

/** A build check over a server whose build id and the owner's business can be changed. */
function setup(firstBuild: string | null = 'build-a') {
  const state = { build: firstBuild, busy: false, time: 0, fails: false }
  const fetchBuild = vi.fn(async () => {
    if (state.fails) throw new Error('offline')
    return state.build
  })
  const reload = vi.fn()
  const check = createBuildCheck({
    fetchBuild,
    reload,
    isBusy: () => state.busy,
    now: () => state.time,
  })
  /** Moves the clock past the least time between asks. */
  const later = () => {
    state.time += CHECK_GAP_MS
  }
  return { state, check, fetchBuild, reload, later }
}

describe('createBuildCheck', () => {
  it('does not reload while the build is unchanged', async () => {
    const { check, reload, later } = setup()
    await check.start()
    later()
    await check.shown()
    check.navigated()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once when the build changed', async () => {
    const { state, check, reload, later } = setup()
    await check.start()
    state.build = 'build-b'
    later()
    await check.shown()
    expect(reload).toHaveBeenCalledOnce()

    // Shown or moved again before the reload lands, nothing reloads twice.
    later()
    await check.shown()
    check.navigated()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('asks at most once every few minutes', async () => {
    const { state, check, fetchBuild, reload } = setup()
    await check.start()
    state.build = 'build-b'
    state.time = CHECK_GAP_MS - 1
    await check.shown()
    expect(fetchBuild).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })

  it('puts the reload off while the owner is busy, until the next quiet moment', async () => {
    const { state, check, reload, later } = setup()
    await check.start()
    state.build = 'build-b'
    state.busy = true
    later()
    await check.shown()
    check.navigated()
    expect(reload).not.toHaveBeenCalled()

    state.busy = false
    check.navigated()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads a put-off build when the page is shown again and quiet, without asking again', async () => {
    const { state, check, fetchBuild, reload, later } = setup()
    await check.start()
    state.build = 'build-b'
    state.busy = true
    later()
    await check.shown()
    state.busy = false
    await check.shown()
    expect(reload).toHaveBeenCalledOnce()
    expect(fetchBuild).toHaveBeenCalledTimes(2)
  })

  it('never reloads when the server names no build', async () => {
    const { state, check, reload, later } = setup(null)
    await check.start()
    later()
    await check.shown()
    state.build = 'build-b'
    later()
    await check.shown()
    // The first id seen is the one compared with, so this is no change.
    expect(reload).not.toHaveBeenCalled()
  })

  it('treats an unreachable server as unknown, not as a new build', async () => {
    const { state, check, reload, later } = setup()
    state.fails = true
    await check.start()
    state.fails = false
    later()
    await check.shown()
    expect(reload).not.toHaveBeenCalled()

    state.fails = true
    later()
    await check.shown()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing on a change of screen when no newer build waits', () => {
    const { check, reload, fetchBuild } = setup()
    check.navigated()
    expect(reload).not.toHaveBeenCalled()
    expect(fetchBuild).not.toHaveBeenCalled()
  })
})
