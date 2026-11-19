import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet, SWIPE_CLOSE_PX } from './Sheet'

/** A page with a button that opens a sheet holding two fields. */
function Page({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Sheet
          title="Blue Bottle"
          subtitle="Today, Chase checking"
          leading={<span>icon</span>}
          trailing={<span>$5.75</span>}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        >
          <input aria-label="Note" />
          <button>Save</button>
        </Sheet>
      )}
    </>
  )
}

async function openSheet(onClose = vi.fn()) {
  render(<Page onClose={onClose} />)
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))
  return { onClose, dialog: screen.getByRole('dialog', { name: 'Blue Bottle' }) }
}

describe('Sheet', () => {
  it('is a modal dialog named by its title that takes focus and holds the page still', async () => {
    const { dialog } = await openSheet()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    expect(screen.getByText('Today, Chase checking')).toHaveClass('sheet-subtitle')
    expect(screen.getByText('$5.75')).toBeInTheDocument()
    // Only up and down: sideways overflow is never hidden.
    expect(document.body.style.overflowY).toBe('hidden')
    expect(document.body.style.overflowX).toBe('')
  })

  it('makes the page behind it inert while open, and only what it made so', async () => {
    const already = document.createElement('div')
    already.setAttribute('inert', '')
    document.body.append(already)
    const { dialog } = await openSheet()
    const page = screen.getByRole('button', { name: 'Open' }).closest('body > *')!
    expect(page).toHaveAttribute('inert')
    expect(dialog.closest('[inert]')).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(page).not.toHaveAttribute('inert')
    // Something inert before the sheet opened stays so.
    expect(already).toHaveAttribute('inert')
    already.remove()
  })

  it('closes on Escape, giving focus back to what opened it and letting the page scroll', async () => {
    const { onClose } = await openSheet()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
    expect(document.body.style.overflowY).toBe('')
  })

  it('gives focus to its fallback when what opened it has left the page', async () => {
    /** A sheet whose button takes away the one that opened it, as filing a row elsewhere does. */
    function Gone({ fallback }: { fallback?: () => HTMLElement | null }) {
      const [open, setOpen] = useState(false)
      const [gone, setGone] = useState(false)
      return (
        <>
          {!gone && <button onClick={() => setOpen(true)}>Open</button>}
          <h1 tabIndex={-1}>Heading</h1>
          {open && (
            <Sheet title="Gone" focusOnClose={fallback} onClose={() => setOpen(false)}>
              <button onClick={() => setGone(true)}>File elsewhere</button>
            </Sheet>
          )}
        </>
      )
    }
    const { unmount } = render(<Gone fallback={() => screen.getByRole('heading')} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(screen.getByRole('button', { name: 'File elsewhere' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('heading', { name: 'Heading' })).toHaveFocus()
    unmount()

    // With no fallback, closing leaves focus where the browser puts it, and nothing breaks.
    render(<Gone />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(screen.getByRole('button', { name: 'File elsewhere' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes from its close button and from a press on the dimmed page', async () => {
    const { onClose } = await openSheet()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(document.querySelector('.sheet-scrim')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab inside, wrapping both ways', async () => {
    await openSheet()
    const close = screen.getByRole('button', { name: 'Close' })
    const save = screen.getByRole('button', { name: 'Save' })
    // From the dialog itself, Shift+Tab goes round to the last element.
    await userEvent.tab({ shift: true })
    expect(save).toHaveFocus()
    await userEvent.tab()
    expect(close).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(save).toHaveFocus()
    // In the middle, Tab moves on as usual.
    screen.getByRole('textbox', { name: 'Note' }).focus()
    await userEvent.tab()
    expect(save).toHaveFocus()
    // Other keys do nothing.
    await userEvent.keyboard('a')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('still hears Escape and Tab when what had focus is gone', async () => {
    const { onClose } = await openSheet()
    // As when the button that was pressed belonged to a view that closed.
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('takes focus back when it shows another view', () => {
    const { rerender } = render(
      <Sheet title="Blue Bottle" focusKey="details" onClose={() => {}}>
        <button>Change</button>
      </Sheet>,
    )
    screen.getByRole('button', { name: 'Change' }).focus()
    rerender(
      <Sheet title="Blue Bottle" focusKey="category" onClose={() => {}}>
        <button>Coffee</button>
      </Sheet>,
    )
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('follows a swipe down on its handle and closes once it has gone far enough', async () => {
    const { onClose, dialog } = await openSheet()
    const handle = document.querySelector('.sheet-handle')!
    fireEvent.pointerMove(handle, { clientY: 300 })
    expect(dialog.style.transform).toBe('')

    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.pointerMove(handle, { clientY: 60 })
    // Upward goes nowhere: the sheet stays put under the finger.
    expect(dialog.style.transform).toBe('translateY(0px)')
    fireEvent.pointerMove(handle, { clientY: 140 })
    expect(dialog.style.transform).toBe('translateY(40px)')
    fireEvent.pointerUp(handle)
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog.style.transform).toBe('')

    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.pointerMove(handle, { clientY: 100 + SWIPE_CLOSE_PX })
    fireEvent.pointerUp(handle)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the pointer while dragging, so a finger that slides off the handle still drags', async () => {
    const capture = vi.spyOn(Element.prototype, 'setPointerCapture')
    const { dialog } = await openSheet()
    const handle = document.querySelector('.sheet-handle')!
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 7 })
    expect(capture).toHaveBeenCalledOnce()
    expect(capture.mock.contexts[0]).toBe(handle)
    // Dragged, the sheet follows at once; let go, its transition slides it back.
    fireEvent.pointerMove(handle, { clientY: 130 })
    expect(dialog.style.transition).toBe('none')
    fireEvent.pointerUp(handle)
    expect(dialog.style.transition).toBe('')
    capture.mockRestore()
  })

  it.each([
    ['the pointer is cancelled', (handle: Element) => fireEvent.pointerCancel(handle)],
    ['the browser takes the pointer', (handle: Element) => fireEvent.lostPointerCapture(handle)],
  ])('slides back without closing when %s', async (_how, letGo) => {
    const { onClose, dialog } = await openSheet()
    const handle = document.querySelector('.sheet-handle')!
    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.pointerMove(handle, { clientY: 300 })
    letGo(handle)
    expect(dialog.style.transform).toBe('')
    fireEvent.pointerMove(handle, { clientY: 400 })
    fireEvent.pointerUp(handle)
    expect(dialog.style.transform).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves the subtitle out when there is none', () => {
    render(
      <Sheet title="New rule" onClose={() => {}}>
        <p>Body</p>
      </Sheet>,
    )
    expect(document.querySelector('.sheet-subtitle')).toBeNull()
  })
})
