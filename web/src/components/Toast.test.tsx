import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toast, TOAST_MS } from './Toast'

afterEach(() => vi.useRealTimers())

const toast = (onAction = vi.fn(), onClose = vi.fn()) => {
  render(<Toast message="Comcast added to Bills" actionLabel="Undo" {...{ onAction, onClose }} />)
  return { onAction, onClose }
}

describe('Toast', () => {
  it('says what happened as a status, and closes itself after TOAST_MS', () => {
    vi.useFakeTimers()
    const { onClose } = toast()
    expect(screen.getByRole('status')).toHaveTextContent('Comcast added to Bills')
    act(() => vi.advanceTimersByTime(TOAST_MS - 1))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('offers its action and a close button', async () => {
    const { onAction, onClose } = toast()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onAction).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
