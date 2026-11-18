import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWidth } from './useWidth'

/** A stand-in ResizeObserver that reports whatever width a test hands it. */
class FakeObserver {
  static current: FakeObserver | undefined
  disconnected = false
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeObserver.current = this
  }
  observe() {}
  disconnect() {
    this.disconnected = true
  }
  report(width: number) {
    const entry = { contentRect: { width } } as ResizeObserverEntry
    act(() => this.callback([entry], this as unknown as ResizeObserver))
  }
}

function Measured() {
  const [ref, width] = useWidth<HTMLDivElement>(640)
  return <div ref={ref}>{width}</div>
}

afterEach(() => vi.unstubAllGlobals())

describe('useWidth', () => {
  it('uses the fallback where ResizeObserver is missing', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render(<Measured />)
    expect(screen.getByText('640')).toBeInTheDocument()
  })

  it('follows the element as it resizes, ignoring a hidden 0', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const { unmount } = render(<Measured />)
    FakeObserver.current!.report(412.4)
    expect(screen.getByText('412')).toBeInTheDocument()
    FakeObserver.current!.report(0)
    expect(screen.getByText('412')).toBeInTheDocument()
    unmount()
    expect(FakeObserver.current!.disconnected).toBe(true)
  })
})
