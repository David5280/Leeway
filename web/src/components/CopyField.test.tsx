// Copying a value, and saying so when the browser will not.

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyField } from './CopyField'

/** A clipboard that answers as given; jsdom has none of its own. */
function clipboard(writeText: (text: string) => Promise<void>) {
  const fake = { writeText: vi.fn(writeText) }
  vi.stubGlobal('navigator', { ...navigator, clipboard: fake })
  return fake.writeText
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CopyField', () => {
  it('copies, confirms for a moment, then offers to copy again', async () => {
    vi.useFakeTimers()
    const writeText = clipboard(async () => {})
    const { unmount } = render(<CopyField value="lww_x" label="Token" />)
    expect(screen.getByLabelText('Token')).toHaveTextContent('lww_x')
    await act(async () => screen.getByRole('button', { name: 'Copy' }).click())
    expect(writeText).toHaveBeenCalledWith('lww_x')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    // Leaving while it confirms stops the timer.
    await act(async () => screen.getByRole('button', { name: 'Copy' }).click())
    unmount()
  })

  it('asks to copy by hand when the browser blocks it', async () => {
    clipboard(async () => {
      throw new Error('blocked')
    })
    render(<CopyField value="lww_x" label="Token" />)
    await act(async () => screen.getByRole('button', { name: 'Copy' }).click())
    expect(screen.getByRole('status')).toHaveTextContent('Select the text and copy it instead.')
  })
})
